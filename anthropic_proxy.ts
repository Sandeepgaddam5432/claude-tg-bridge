// ═══════════════════════════════════════════════════════════════
//  anthropic_proxy.ts — Anthropic-to-OpenAI Translation Proxy
//
//  Bridges Claude Code (which speaks Anthropic Messages API) to
//  the Z.AI internal proxy (which speaks OpenAI Chat Completions API).
//
//  Endpoint: POST /v1/messages  (Anthropic format)
//  Translates to: Z.AI /v1/chat/completions (OpenAI format)
//  Translates response back to Anthropic format
//
//  Also handles /v1/messages?beta=true with streaming
// ═══════════════════════════════════════════════════════════════

import { readFileSync, existsSync } from "fs";
import { createServer, IncomingMessage, ServerResponse } from "http";

// ─── Load Z.AI config ─────────────────────────────────────
const ZAI_CONFIG = JSON.parse(
  readFileSync("/etc/.z-ai-config", "utf-8")
);

const ZAI_BASE_URL = ZAI_CONFIG.baseUrl || "https://internal-api.z.ai/v1";
const ZAI_TOKEN = ZAI_CONFIG.token;
const ZAI_CHAT_ID = ZAI_CONFIG.chatId;
const ZAI_USER_ID = ZAI_CONFIG.userId;

// ═══════════════════════════════════════════════════════════════
//  Anthropic ↔ OpenAI Conversion
// ═══════════════════════════════════════════════════════════════

interface AnthropicContent {
  type: "text" | "image" | "tool_use" | "tool_result";
  text?: string;
  source?: { type: string; media_type: string; data: string };
  id?: string;
  name?: string;
  input?: any;
  tool_use_id?: string;
  content?: any;
}

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContent[];
}

interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  system?: string | AnthropicContent[];
  max_tokens: number;
  temperature?: number;
  tools?: any[];
  tool_choice?: any;
  stream?: boolean;
  stop_sequences?: string[];
  thinking?: { type: string; budget_tokens?: number };
}

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | any[];
  tool_calls?: any[];
  tool_call_id?: string;
  name?: string;
}

/** Convert Anthropic messages array to OpenAI messages array */
function convertMessages(req: AnthropicRequest): OpenAIMessage[] {
  const out: OpenAIMessage[] = [];

  // System prompt
  if (req.system) {
    if (typeof req.system === "string") {
      out.push({ role: "system", content: req.system });
    } else if (Array.isArray(req.system)) {
      const text = req.system
        .filter((c) => c.type === "text")
        .map((c) => c.text || "")
        .join("\n\n");
      if (text) out.push({ role: "system", content: text });
    }
  }

  // Messages
  for (const msg of req.messages) {
    if (typeof msg.content === "string") {
      out.push({ role: msg.role as any, content: msg.content });
      continue;
    }

    // Array content
    if (msg.role === "assistant") {
      // Assistant may have tool_use blocks
      const textParts: string[] = [];
      const toolCalls: any[] = [];
      for (const c of msg.content) {
        if (c.type === "text" && c.text) textParts.push(c.text);
        if (c.type === "tool_use") {
          toolCalls.push({
            id: c.id,
            type: "function",
            function: {
              name: c.name,
              arguments: JSON.stringify(c.input || {}),
            },
          });
        }
      }
      const assistantMsg: OpenAIMessage = {
        role: "assistant",
        content: textParts.join("\n") || null,
      };
      if (toolCalls.length > 0) assistantMsg.tool_calls = toolCalls;
      out.push(assistantMsg);
    } else if (msg.role === "user") {
      // User may have tool_result blocks or text or image
      const toolResults = msg.content.filter((c) => c.type === "tool_result");
      const textParts: string[] = [];
      const imageParts: any[] = [];

      for (const c of msg.content) {
        if (c.type === "text" && c.text) textParts.push(c.text);
        if (c.type === "image" && c.source) {
          imageParts.push({
            type: "image_url",
            image_url: {
              url: `data:${c.source.media_type};base64,${c.source.data}`,
            },
          });
        }
      }

      // Tool results become separate "tool" role messages in OpenAI format
      for (const tr of toolResults) {
        let content = "";
        if (typeof tr.content === "string") {
          content = tr.content;
        } else if (Array.isArray(tr.content)) {
          content = tr.content
            .filter((c: any) => c.type === "text")
            .map((c: any) => c.text || "")
            .join("\n");
        } else if (tr.content) {
          content = JSON.stringify(tr.content);
        }
        out.push({
          role: "tool",
          content,
          tool_call_id: tr.tool_use_id,
        });
      }

      // If we have text/image, add as user message
      if (textParts.length > 0 || imageParts.length > 0) {
        if (imageParts.length > 0) {
          const content: any[] = [];
          if (textParts.length > 0) {
            content.push({ type: "text", text: textParts.join("\n") });
          }
          content.push(...imageParts);
          out.push({ role: "user", content });
        } else {
          out.push({ role: "user", content: textParts.join("\n") });
        }
      }
    }
  }

  return out;
}

/** Convert Anthropic tools array to OpenAI tools format */
function convertTools(tools: any[]): any[] {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description || "",
      parameters: t.input_schema || { type: "object", properties: {} },
    },
  }));
}

/** Convert Anthropic tool_choice to OpenAI format */
function convertToolChoice(tc: any): any {
  if (!tc) return undefined;
  if (tc.type === "auto") return "auto";
  if (tc.type === "any") return "required";
  if (tc.type === "tool") {
    return { type: "function", function: { name: tc.name } };
  }
  return undefined;
}

/** Convert OpenAI response back to Anthropic format */
function convertResponseToAnthropic(openaiResp: any, model: string): any {
  const choice = openaiResp.choices?.[0];
  if (!choice) {
    return {
      id: openaiResp.id || `msg_${Date.now()}`,
      type: "message",
      role: "assistant",
      model,
      content: [{ type: "text", text: "(no response)" }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
      },
    };
  }

  const msg = choice.message;
  const content: any[] = [];

  // Text content
  if (msg.content) {
    content.push({ type: "text", text: msg.content });
  }

  // Tool calls
  if (msg.tool_calls && msg.tool_calls.length > 0) {
    for (const tc of msg.tool_calls) {
      let input: any = {};
      try {
        input = JSON.parse(tc.function.arguments);
      } catch {}
      content.push({
        type: "tool_use",
        id: tc.id,
        name: tc.function.name,
        input,
      });
    }
  }

  // Map finish_reason
  const stopReasonMap: Record<string, string> = {
    stop: "end_turn",
    length: "max_tokens",
    tool_calls: "tool_use",
    function_call: "tool_use",
    content_filter: "end_turn",
  };

  return {
    id: openaiResp.id || `msg_${Date.now()}`,
    type: "message",
    role: "assistant",
    model,
    content: content.length > 0 ? content : [{ type: "text", text: "" }],
    stop_reason: stopReasonMap[choice.finish_reason] || "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: openaiResp.usage?.prompt_tokens || 0,
      output_tokens: openaiResp.usage?.completion_tokens || 0,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
//  Streaming Conversion (SSE)
// ═══════════════════════════════════════════════════════════════

/** Format an SSE event */
function sseEvent(event: string, data: any): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Generate Anthropic-format streaming events from OpenAI stream chunks */
function streamToAnthropicSSE(
  openaiStream: ReadableStream<Uint8Array>,
  model: string,
  res: ServerResponse
): void {
  const messageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Send message_start
  res.write(
    sseEvent("message_start", {
      type: "message_start",
      message: {
        id: messageId,
        type: "message",
        role: "assistant",
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    })
  );

  res.write(
    sseEvent("ping", { type: "ping" })
  );

  // Track content blocks
  let textBlockStarted = false;
  let textBlockIndex = 0;
  const toolBlocks: Record<number, { id: string; name: string; args: string }> = {};
  let inputTokens = 0;
  let outputTokens = 0;

  const reader = openaiStream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const dataStr = line.slice(6).trim();
          if (dataStr === "[DONE]") continue;

          let chunk: any;
          try {
            chunk = JSON.parse(dataStr);
          } catch {
            continue;
          }

          if (chunk.usage) {
            inputTokens = chunk.usage.prompt_tokens || inputTokens;
            outputTokens = chunk.usage.completion_tokens || outputTokens;
          }

          const delta = chunk.choices?.[0]?.delta;
          if (!delta) continue;

          // Text content
          if (delta.content) {
            if (!textBlockStarted) {
              res.write(
                sseEvent("content_block_start", {
                  type: "content_block_start",
                  index: textBlockIndex,
                  content_block: { type: "text", text: "" },
                })
              );
              textBlockStarted = true;
            }
            res.write(
              sseEvent("content_block_delta", {
                type: "content_block_delta",
                index: textBlockIndex,
                delta: { type: "text_delta", text: delta.content },
              })
            );
            outputTokens++;
          }

          // Tool calls (streaming)
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index;
              if (!toolBlocks[idx]) {
                // Close any open text block
                if (textBlockStarted) {
                  res.write(
                    sseEvent("content_block_stop", {
                      type: "content_block_stop",
                      index: textBlockIndex,
                    })
                  );
                  textBlockStarted = false;
                  textBlockIndex++;
                }

                toolBlocks[idx] = {
                  id: tc.id || `toolu_${Date.now()}_${idx}`,
                  name: tc.function?.name || "",
                  args: "",
                };

                res.write(
                  sseEvent("content_block_start", {
                    type: "content_block_start",
                    index: textBlockIndex + idx,
                    content_block: {
                      type: "tool_use",
                      id: toolBlocks[idx].id,
                      name: toolBlocks[idx].name,
                      input: {},
                    },
                  })
                );
              }

              if (tc.function?.arguments) {
                toolBlocks[idx].args += tc.function.arguments;
                res.write(
                  sseEvent("content_block_delta", {
                    type: "content_block_delta",
                    index: textBlockIndex + idx,
                    delta: {
                      type: "input_json_delta",
                      partial_json: tc.function.arguments,
                    },
                  })
                );
              }
            }
          }
        }
      }

      // Close any open text block
      if (textBlockStarted) {
        res.write(
          sseEvent("content_block_stop", {
            type: "content_block_stop",
            index: textBlockIndex,
          })
        );
      }

      // Close all tool blocks
      for (const idx of Object.keys(toolBlocks)) {
        res.write(
          sseEvent("content_block_stop", {
            type: "content_block_stop",
            index: textBlockIndex + parseInt(idx),
          })
        );
      }

      // message_delta (final)
      res.write(
        sseEvent("message_delta", {
          type: "message_delta",
          delta: {
            stop_reason: "end_turn",
            stop_sequence: null,
          },
          usage: { output_tokens: outputTokens },
        })
      );

      res.write(sseEvent("message_stop", { type: "message_stop" }));
    } catch (err: any) {
      console.error("Stream conversion error:", err.message);
    } finally {
      res.end();
    }
  })();
}

// ═══════════════════════════════════════════════════════════════
//  HTTP Server
// ═══════════════════════════════════════════════════════════════

const PORT = parseInt(process.env.PROXY_PORT || "8082");

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  // CORS + headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  // Health check
  if (req.url === "/" || req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "anthropic-proxy", model: "glm-5.2-plus" }));
    return;
  }

  // Models endpoint (Claude Code may query)
  if (req.url === "/v1/models") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      object: "list",
      data: [{
        id: "glm-5.2-plus",
        object: "model",
        created: Math.floor(Date.now() / 1000),
        owned_by: "zhipu",
      }],
    }));
    return;
  }

  // Main messages endpoint
  if (req.url?.startsWith("/v1/messages") && req.method === "POST") {
    // Read body
    let body = "";
    for await (const chunk of req) body += chunk;

    let anthropicReq: AnthropicRequest;
    try {
      anthropicReq = JSON.parse(body);
    } catch (err: any) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Invalid JSON: " + err.message } }));
      return;
    }

    // Convert to OpenAI format
    const openaiMessages = convertMessages(anthropicReq);
    const openaiReq: any = {
      model: anthropicReq.model || "glm-5.2-plus",
      messages: openaiMessages,
      max_tokens: anthropicReq.max_tokens || 8192,
      temperature: anthropicReq.temperature ?? 0.3,
    };

    if (anthropicReq.tools && anthropicReq.tools.length > 0) {
      openaiReq.tools = convertTools(anthropicReq.tools);
    }

    const toolChoice = convertToolChoice(anthropicReq.tool_choice);
    if (toolChoice) openaiReq.tool_choice = toolChoice;

    if (anthropicReq.stop_sequences && anthropicReq.stop_sequences.length > 0) {
      openaiReq.stop = anthropicReq.stop_sequences;
    }

    // Forward to Z.AI
    const isStreaming = anthropicReq.stream === true;

    if (isStreaming) {
      openaiReq.stream = true;
      openaiReq.stream_options = { include_usage: true };
    }

    console.log(`[PROXY] ${new Date().toISOString()} model=${openaiReq.model} msgs=${openaiMessages.length} tools=${openaiReq.tools?.length || 0} stream=${isStreaming}`);

    try {
      const zaiResp = await fetch(`${ZAI_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer Z.ai",
          "X-Z-AI-From": "Z",
          "X-Token": ZAI_TOKEN,
          "X-Chat-Id": ZAI_CHAT_ID,
          "X-User-Id": ZAI_USER_ID,
        },
        body: JSON.stringify(openaiReq),
      });

      if (!zaiResp.ok) {
        const errText = await zaiResp.text();
        console.error(`[PROXY] ZAI error ${zaiResp.status}: ${errText.slice(0, 200)}`);
        res.writeHead(zaiResp.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          error: {
            type: "api_error",
            message: `Upstream error ${zaiResp.status}: ${errText.slice(0, 500)}`,
          },
        }));
        return;
      }

      if (isStreaming) {
        // Stream response back
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        });
        streamToAnthropicSSE(zaiResp.body as any, openaiReq.model, res);
      } else {
        // Non-streaming
        const data = await zaiResp.json();
        const anthropicResp = convertResponseToAnthropic(data, openaiReq.model);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(anthropicResp));
        console.log(`[PROXY] Response: stop=${anthropicResp.stop_reason} in=${anthropicResp.usage.input_tokens} out=${anthropicResp.usage.output_tokens} blocks=${anthropicResp.content.length}`);
      }
    } catch (err: any) {
      console.error(`[PROXY] Fetch error:`, err.message);
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        error: {
          type: "api_error",
          message: `Proxy fetch failed: ${err.message}`,
        },
      }));
    }
    return;
  }

  // 404 for unknown
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: { message: `Unknown route: ${req.method} ${req.url}` } }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`════════════════════════════════════════════════`);
  console.log(`  Anthropic → OpenAI Proxy for Claude Code`);
  console.log(`  Listening on: http://127.0.0.1:${PORT}`);
  console.log(`  Endpoint:     POST /v1/messages`);
  console.log(`  Backend:      ${ZAI_BASE_URL}`);
  console.log(`  Default model: glm-5.2-plus`);
  console.log(`════════════════════════════════════════════════`);
  console.log("");
  console.log("Use with Claude Code:");
  console.log(`  ANTHROPIC_BASE_URL=http://127.0.0.1:${PORT} \\`);
  console.log(`  ANTHROPIC_API_KEY=dummy \\`);
  console.log(`  ANTHROPIC_MODEL=glm-5.2-plus \\`);
  console.log(`  claude -p "your prompt"`);
  console.log("");
});

server.on("error", (err: any) => {
  console.error("Server error:", err.message);
  process.exit(1);
});
