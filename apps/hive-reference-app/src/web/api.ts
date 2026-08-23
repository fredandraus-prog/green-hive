interface ApiErrorPayload {
  readonly error?: { readonly code?: string; readonly message?: string };
}

const FRIENDLY_ERRORS: Readonly<Record<string, string>> = {
  INVALID_AUTH_INPUT: 'Confira os dados informados e tente novamente.',
  AUTH_INVALID_CREDENTIALS: 'E-mail ou senha incorretos.',
  AUTH_SESSION_INVALID: 'Sua sessão expirou. Entre novamente.',
  AUTH_SIGN_UP_FAILED: 'Não foi possível criar a conta. O e-mail pode já estar em uso.',
  AUTH_RECOVERY_FAILED: 'Não foi possível iniciar a recuperação agora.',
  AUTH_RECOVERY_EXCHANGE_FAILED: 'Este link de recuperação é inválido ou expirou.',
  AUTH_PASSWORD_UPDATE_FAILED: 'Não foi possível atualizar a senha.',
  INVALID_ACCOUNT_INPUT: 'Revise os dados do perfil.',
  INVALID_PROJECT_INPUT: 'Informe um nome válido para o projeto.',
  PROJECT_NOT_FOUND: 'Projeto não encontrado.',
  INVALID_PROJECT_TRANSITION: 'Essa mudança não é permitida para o projeto.',
  INVALID_WORKSPACE_INPUT: 'Informe um nome válido para o workspace.',
  WORKSPACE_ACCESS_DENIED: 'Você não possui permissão para esta alteração.',
  WORKSPACE_NOT_FOUND: 'Workspace não encontrado.',
  AUTH_ORGANIZATION_ACCESS_DENIED: 'Sua sessão não possui acesso a este workspace.',
  AUDIT_ACCESS_DENIED: 'Você não possui acesso ao histórico deste workspace.',
  AUDIT_OPERATION_FAILED: 'Não foi possível carregar o histórico de atividades.',
  INTERNAL_ERROR: 'Ocorreu um erro inesperado. Tente novamente.',
};

export class ApiFailure extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string) {
    super(FRIENDLY_ERRORS[code] ?? 'Não foi possível concluir esta ação.');
    this.name = 'ApiFailure';
    this.status = status;
    this.code = code;
  }
}

export async function api<Result>(path: string, options: RequestInit = {}): Promise<Result> {
  const response = await fetch(path, {
    ...options,
    credentials: 'include',
    headers: {
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as ApiErrorPayload;
    throw new ApiFailure(response.status, payload.error?.code ?? 'INTERNAL_ERROR');
  }
  if (response.status === 204) return undefined as Result;
  return response.json() as Promise<Result>;
}
