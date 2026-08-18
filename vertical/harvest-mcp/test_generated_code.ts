// Fixed version of the generated code for testing
// Issues found:
// 1. Missing parameter declarations for function arguments
// 2. Missing authConfig variable
// 3. Missing processResponse function
// 4. Headers.entries() issue

// Type definitions
interface ApiResponse<T = unknown> {
  success: boolean;
  data: T;
  status: number;
  headers: Record<string, string>;
}

interface RequestOptions {
  method: string;
  headers: Record<string, string>;
  body?: string;
}

// Authentication configuration interface
interface AuthConfig {
  type: "bearer" | "api_key" | "basic" | "session" | "custom";
  token?: string;
  apiKey?: string;
  username?: string;
  password?: string;
  sessionCookies?: Record<string, string>;
  customHeaders?: Record<string, string>;
  tokenRefreshUrl?: string;
  onTokenExpired?: () => Promise<string>;
}

// Authentication error for retry logic
class AuthenticationError extends Error {
  public status: number;
  public response?: unknown;

  constructor(message: string, status: number, response?: unknown) {
    super(message);
    this.name = "AuthenticationError";
    this.status = status;
    this.response = response;
  }
}

// Search parameters interface
interface SearchParams {
  texto?: string;
  pesquisaSomenteNasEmentas?: boolean;
  filtroRapidoData?: string;
  dataInicio?: string;
  dataFim?: string;
  page?: number;
  size?: number;
}

export type { ApiResponse, RequestOptions, AuthConfig, SearchParams };
export { AuthenticationError };

/**
 * Main API call: GET https://jurisprudencia.jt.jus.br/jurisprudencia-nacional-backend/api/no-auth/pesquisa
 */
async function searchJurisprudenceAnalyze(
  params: SearchParams = {},
  authConfig?: AuthConfig
): Promise<ApiResponse<unknown>> {
  try {
    const {
      texto = "7ª 8ª hora analista bancário",
      pesquisaSomenteNasEmentas = false,
      filtroRapidoData = "AnoAtual",
      dataInicio = "2025-01-01",
      dataFim = "2025-07-20",
      page = 0,
      size = 5,
    } = params;

    const url = new URL(
      "https://jurisprudencia.jt.jus.br/jurisprudencia-nacional-backend/api/no-auth/pesquisa"
    );

    // Static parameters
    url.searchParams.set("latitude", "0");
    url.searchParams.set("longitude", "0");
    url.searchParams.set("verTodosPrecedentes", "false");

    // Configurable parameters
    if (texto !== undefined && texto !== null) {
      url.searchParams.set("texto", String(texto));
    }
    if (
      pesquisaSomenteNasEmentas !== undefined &&
      pesquisaSomenteNasEmentas !== null
    ) {
      url.searchParams.set(
        "pesquisaSomenteNasEmentas",
        String(pesquisaSomenteNasEmentas)
      );
    }
    if (filtroRapidoData !== undefined && filtroRapidoData !== null) {
      url.searchParams.set("filtroRapidoData", String(filtroRapidoData));
    }
    if (dataInicio !== undefined && dataInicio !== null) {
      url.searchParams.set("dataInicio", String(dataInicio));
    }
    if (dataFim !== undefined && dataFim !== null) {
      url.searchParams.set("dataFim", String(dataFim));
    }
    if (page !== undefined && page !== null) {
      url.searchParams.set("page", String(page));
    }
    if (size !== undefined && size !== null) {
      url.searchParams.set("size", String(size));
    }

    // Dynamic parameters (resolved from previous requests)
    // TODO: Resolve 'sessionId' from previous API response
    url.searchParams.set("sessionId", "_7jh54hy"); // Placeholder value
    // TODO: Resolve 'juristkn' from previous API response
    url.searchParams.set("juristkn", "c95b06f57d12d4"); // Placeholder value
    // TODO: Resolve 'tribunais' from previous API response
    url.searchParams.set("tribunais", ""); // Placeholder value
    // TODO: Resolve 'colecao' from previous API response
    url.searchParams.set("colecao", "acordaos"); // Placeholder value

    const headers: Record<string, string> = {};

    // No authentication required - this is a public endpoint

    const options: RequestOptions = {
      method: "GET",
      headers,
    };

    console.log("Making request to:", url.toString());

    const response = await fetch(url.toString(), options);

    // Handle authentication errors with retry logic
    if (response.status === 401 || response.status === 403) {
      const authError = new AuthenticationError(
        `Authentication failed: ${response.status} ${response.statusText}`,
        response.status,
        await response.text()
      );

      // If token refresh is available, attempt to refresh and retry
      if (authConfig?.onTokenExpired) {
        try {
          console.log("Attempting token refresh due to auth failure...");
          const newToken = await authConfig.onTokenExpired();
          // Update token and retry request
          if (authConfig.type === "bearer" && newToken) {
            authConfig.token = newToken;
            options.headers.Authorization = `Bearer ${newToken}`;
            console.log("Token refreshed, retrying request...");
            // Retry the request once
            const retryResponse = await fetch(url.toString(), options);
            if (retryResponse.ok) {
              return await processResponse(retryResponse);
            }
          }
        } catch (refreshError) {
          console.warn("Token refresh failed:", refreshError);
        }
      }

      throw authError;
    }

    if (!response.ok) {
      throw new Error(
        `Request failed: ${response.status} ${response.statusText}`
      );
    }

    return await processResponse(response);
  } catch (error) {
    throw new Error(
      `searchJurisprudenceAnalyze failed: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

// Helper function to process response
async function processResponse(
  response: Response
): Promise<ApiResponse<unknown>> {
  const contentType = response.headers.get("content-type") || "";
  let data: unknown;

  if (contentType.includes("application/json")) {
    data = await response.json();
  } else {
    data = await response.text();
  }

  // Convert Headers to plain object
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  return {
    success: true,
    data,
    status: response.status,
    headers,
  };
}

/**
 * Main function that executes the complete API workflow
 */
async function main(params?: SearchParams): Promise<ApiResponse> {
  // Execute requests in dependency order
  const result = await searchJurisprudenceAnalyze(params);
  return result;
}

// Export all functions for individual use
export { searchJurisprudenceAnalyze, main };

// Test execution
if (require.main === module) {
  main({
    texto: "analista bancário",
    page: 0,
    size: 3,
  })
    .then((result) => {
      console.log("API call successful!");
      console.log("Status:", result.status);
      console.log("Data type:", typeof result.data);
      console.log(
        "Data preview:",
        `${JSON.stringify(result.data).substring(0, 200)}...`
      );
    })
    .catch((error) => {
      console.error("API call failed:", error.message);
    });
}
