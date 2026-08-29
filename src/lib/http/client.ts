export async function readApiError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {
      error?: string;
      issues?: Array<{ message?: string }>;
    };
    return body.issues?.[0]?.message || body.error || `请求失败（${response.status}）`;
  } catch {
    return `请求失败（${response.status}）`;
  }
}
