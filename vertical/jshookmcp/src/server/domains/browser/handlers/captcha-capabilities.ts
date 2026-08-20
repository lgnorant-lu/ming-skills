import { capabilityReport, type CapabilityEntryOptions } from '@server/domains/shared/capabilities';
import { R, type ToolResponse } from '@server/domains/shared/ResponseBuilder';
import type { CodeCollector } from '@server/domains/shared/modules/collector';

function getConfiguredProvider(): string {
  return (process.env.CAPTCHA_PROVIDER || '').trim().toLowerCase() || 'manual';
}

function getConfiguredBaseUrl(): string {
  return (
    process.env.CAPTCHA_SOLVER_BASE_URL?.trim() ||
    process.env.CAPTCHA_2CAPTCHA_BASE_URL?.trim() ||
    ''
  );
}

function getProviderBaseUrl(provider: '2captcha' | 'anticaptcha' | 'capsolver'): string {
  if (provider === '2captcha') {
    return getConfiguredBaseUrl();
  }
  if (provider === 'anticaptcha') {
    return process.env.CAPTCHA_ANTICAPTCHA_BASE_URL?.trim() || '';
  }
  return process.env.CAPTCHA_CAPSOLVER_BASE_URL?.trim() || '';
}

function getTwoCaptchaCapability(): CapabilityEntryOptions {
  const configuredProvider = getConfiguredProvider();
  const baseUrl = getProviderBaseUrl('2captcha');
  const apiKeyConfigured = Boolean(process.env.CAPTCHA_API_KEY?.trim());
  const baseUrlConfigured = baseUrl.length > 0;
  const available = apiKeyConfigured && baseUrlConfigured;

  return {
    capability: 'captcha_external_service_2captcha',
    status: available ? 'available' : 'unavailable',
    reason: available
      ? undefined
      : 'The 2captcha-compatible external path needs both CAPTCHA_API_KEY and CAPTCHA_SOLVER_BASE_URL.',
    fix: available
      ? undefined
      : 'Set CAPTCHA_API_KEY and CAPTCHA_SOLVER_BASE_URL to enable external_service mode.',
    details: {
      tools: ['captcha_vision_solve', 'widget_challenge_solve'],
      configuredProvider,
      defaultExternalProviderSupported: configuredProvider === '2captcha',
      apiKeyConfigured,
      baseUrlConfigured,
      ...(baseUrlConfigured ? { baseUrl } : {}),
    },
  };
}

function getJsonTaskProviderCapability(
  provider: 'anticaptcha' | 'capsolver',
): CapabilityEntryOptions {
  const configuredProvider = getConfiguredProvider();
  const baseUrl = getProviderBaseUrl(provider);
  const apiKeyConfigured = Boolean(process.env.CAPTCHA_API_KEY?.trim());
  const available = apiKeyConfigured && baseUrl.length > 0;

  return {
    capability: `captcha_external_service_${provider}`,
    status: available ? 'available' : 'unavailable',
    reason: available
      ? undefined
      : `${provider} requires CAPTCHA_API_KEY and a reachable API base URL.`,
    fix: available
      ? undefined
      : `Set CAPTCHA_API_KEY and ${provider === 'anticaptcha' ? 'CAPTCHA_ANTICAPTCHA_BASE_URL' : 'CAPTCHA_CAPSOLVER_BASE_URL'}.`,
    details: {
      tools: ['captcha_vision_solve', 'widget_challenge_solve'],
      configuredProvider,
      defaultExternalProviderSupported: configuredProvider === provider,
      apiKeyConfigured,
      baseUrlConfigured: baseUrl.length > 0,
      baseUrl,
    },
  };
}

async function getWidgetHookCapability(collector: CodeCollector): Promise<CapabilityEntryOptions> {
  let page;
  try {
    page = await collector.getActivePage();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      capability: 'captcha_widget_hook_current_page',
      status: 'unknown',
      reason: `Current page availability check failed: ${message}`,
      fix: 'Attach or launch a browser page before using hook mode.',
      details: {
        tools: ['widget_challenge_solve'],
        pageAttached: false,
      },
    };
  }

  if (!page) {
    return {
      capability: 'captcha_widget_hook_current_page',
      status: 'unknown',
      reason: 'No active page is attached.',
      fix: 'Attach or launch a browser page before using hook mode.',
      details: {
        tools: ['widget_challenge_solve'],
        pageAttached: false,
      },
    };
  }

  return {
    capability: 'captcha_widget_hook_current_page',
    status: 'available',
    reason: 'Hook mode is available when the caller provides an explicit callbackName.',
    details: {
      tools: ['widget_challenge_solve'],
      pageAttached: true,
      requiresExplicitCallbackName: true,
      requiresExplicitSiteKey: true,
    },
  };
}

export async function handleCaptchaSolverCapabilities(
  collector: CodeCollector,
): Promise<ToolResponse> {
  const configuredProvider = getConfiguredProvider();
  const widgetHookCapability = await getWidgetHookCapability(collector);

  return R.raw(
    capabilityReport(
      'captcha_solver_capabilities',
      [
        {
          capability: 'captcha_manual',
          status: 'available',
          details: {
            tools: ['captcha_vision_solve', 'widget_challenge_solve'],
          },
        },
        getTwoCaptchaCapability(),
        getJsonTaskProviderCapability('anticaptcha'),
        getJsonTaskProviderCapability('capsolver'),
        widgetHookCapability,
      ],
      {
        configuredProvider,
      },
    ),
  );
}
