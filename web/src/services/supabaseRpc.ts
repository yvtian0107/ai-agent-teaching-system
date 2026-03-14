import { getSupabaseClient } from "@/lib/supabase";

interface PostgrestLikeError {
  message: string;
  details?: string | null;
  hint?: string | null;
  code?: string;
}

function toReadableRpcError(functionName: string, error: PostgrestLikeError): Error {
  const parts = [error.message];

  if (error.details) {
    parts.push(`details: ${error.details}`);
  }

  if (error.hint) {
    parts.push(`hint: ${error.hint}`);
  }

  if (error.code) {
    parts.push(`code: ${error.code}`);
  }

  return new Error(`RPC ${functionName} 调用失败: ${parts.join(" | ")}`);
}

export async function supabaseRpc<TData>(
  functionName: string,
  params?: Record<string, unknown>
): Promise<TData> {
  const supabase = getSupabaseClient();
  // current workspace does not have generated RPC typings for all functions yet.
  const { data, error } = await supabase.rpc(functionName, (params ?? {}) as never);

  if (error) {
    throw toReadableRpcError(functionName, error);
  }

  return data as TData;
}
