/**
 * Gateway 认证客户端
 * 复用 Gateway 的 token 验证机制
 */

import WebSocket from "ws";

const GATEWAY_URL = process.env.GATEWAY_URL || "ws://127.0.0.1:18789";
const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN || process.env.LOCAL_API_TOKEN || "";

interface GatewayResponse {
  id: string;
  result?: unknown;
  error?: { code: string; message: string };
}

interface VerifyResult {
  valid: boolean;
  nodeId?: string;
  role?: string;
  scopes?: string[];
}

let ws: WebSocket | null = null;
let requestId = 0;
const pendingRequests = new Map<string, { resolve: Function; reject: Function }>();

/**
 * 连接到 Gateway WebSocket
 */
async function connect(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      resolve();
      return;
    }

    ws = new WebSocket(GATEWAY_URL);

    ws.on("open", () => {
      console.log("[gateway-auth] connected to Gateway");
      resolve();
    });

    ws.on("message", (data) => {
      try {
        const response: GatewayResponse = JSON.parse(data.toString());
        const pending = pendingRequests.get(response.id);
        if (pending) {
          pendingRequests.delete(response.id);
          if (response.error) {
            pending.reject(new Error(response.error.message));
          } else {
            pending.resolve(response.result);
          }
        }
      } catch (err) {
        console.error("[gateway-auth] parse error:", err);
      }
    });

    ws.on("error", (err) => {
      console.error("[gateway-auth] WebSocket error:", err.message);
      reject(err);
    });

    ws.on("close", () => {
      console.log("[gateway-auth] disconnected from Gateway");
      ws = null;
    });
  });
}

/**
 * 发送请求到 Gateway
 */
async function sendRequest(method: string, params: unknown): Promise<unknown> {
  await connect();

  return new Promise((resolve, reject) => {
    const id = `req-${++requestId}`;
    const message = JSON.stringify({
      id,
      method,
      params,
      auth: { token: GATEWAY_TOKEN },
    });

    pendingRequests.set(id, { resolve, reject });
    ws!.send(message);

    // 超时处理
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error("Request timeout"));
      }
    }, 10000);
  });
}

/**
 * 验证 token
 * 使用 Gateway 的 node.pair.verify API
 */
export async function verifyToken(token: string): Promise<VerifyResult> {
  try {
    const result = await sendRequest("node.pair.verify", { token }) as {
      valid?: boolean;
      nodeId?: string;
      role?: string;
      scopes?: string[];
    };

    return {
      valid: result.valid ?? false,
      nodeId: result.nodeId,
      role: result.role,
      scopes: result.scopes,
    };
  } catch (err) {
    console.error("[gateway-auth] verify error:", err);
    return { valid: false };
  }
}

/**
 * 检查 Gateway 是否可用
 */
export async function checkGatewayHealth(): Promise<boolean> {
  try {
    await connect();
    return true;
  } catch {
    return false;
  }
}

/**
 * 关闭连接
 */
export function close(): void {
  if (ws) {
    ws.close();
    ws = null;
  }
}
