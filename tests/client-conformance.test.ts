import { describe, expect, it } from 'vitest';

type StaticRecognition = {
  recognized: boolean;
  warningOnly: true;
  reason:
    | 'recognized'
    | 'malformed-json'
    | 'insufficient-static-config'
    | 'missing-cli'
    | 'timeout'
    | 'non-zero-exit';
  config: Record<string, unknown> | null;
};

type StaticProbeResult =
  | { kind: 'ok'; stdout: string }
  | { kind: 'missing-cli' }
  | { kind: 'timeout' }
  | { kind: 'non-zero-exit'; exitCode: number; stderr: string };

type ReachabilityAssessment = {
  stage: 'daemon-reachability';
  attempted: boolean;
  reachable: boolean;
  warningOnly: true;
  reason: 'connected' | 'failed-connection' | 'skipped-without-static-recognition';
};

type LiveToolAssessment = {
  stage: 'live-tool-observation';
  attempted: boolean;
  observed: boolean;
  warningOnly: true;
  reason: 'observed-tools' | 'unavailable-live-tools' | 'skipped-without-reachability';
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

// Private conformance model only: it captures the minimum client-recognition
// contract without turning these test fixtures into a production API.
function recognizeStaticAtlasConfig(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  if (record.serverName !== 'xurgo-atlas') {
    return false;
  }
  if (record.transport !== 'streamable-http') {
    return false;
  }
  if (!isNonEmptyString(record.url)) {
    return false;
  }

  const mcpServers = record.mcpServers;
  if (!mcpServers || typeof mcpServers !== 'object') {
    return false;
  }

  const atlasServer = (mcpServers as Record<string, unknown>)['xurgo-atlas'];
  if (!atlasServer || typeof atlasServer !== 'object') {
    return false;
  }

  return isNonEmptyString((atlasServer as Record<string, unknown>).url);
}

function assessStaticDiscovery(result: StaticProbeResult): StaticRecognition {
  if (result.kind === 'missing-cli') {
    return {
      recognized: false,
      warningOnly: true,
      reason: 'missing-cli',
      config: null,
    };
  }

  if (result.kind === 'timeout') {
    return {
      recognized: false,
      warningOnly: true,
      reason: 'timeout',
      config: null,
    };
  }

  if (result.kind === 'non-zero-exit') {
    return {
      recognized: false,
      warningOnly: true,
      reason: 'non-zero-exit',
      config: null,
    };
  }

  try {
    const parsed = JSON.parse(result.stdout) as unknown;
    if (!recognizeStaticAtlasConfig(parsed)) {
      return {
        recognized: false,
        warningOnly: true,
        reason: 'insufficient-static-config',
        config: parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null,
      };
    }

    return {
      recognized: true,
      warningOnly: true,
      reason: 'recognized',
      config: parsed,
    };
  } catch {
    return {
      recognized: false,
      warningOnly: true,
      reason: 'malformed-json',
      config: null,
    };
  }
}

function assessDaemonReachability(
  staticRecognition: StaticRecognition,
  connected: boolean,
): ReachabilityAssessment {
  if (!staticRecognition.recognized) {
    return {
      stage: 'daemon-reachability',
      attempted: false,
      reachable: false,
      warningOnly: true,
      reason: 'skipped-without-static-recognition',
    };
  }

  if (!connected) {
    return {
      stage: 'daemon-reachability',
      attempted: true,
      reachable: false,
      warningOnly: true,
      reason: 'failed-connection',
    };
  }

  return {
    stage: 'daemon-reachability',
    attempted: true,
    reachable: true,
    warningOnly: true,
    reason: 'connected',
  };
}

function assessLiveToolObservation(
  reachability: ReachabilityAssessment,
  toolsAvailable: boolean,
): LiveToolAssessment {
  if (!reachability.reachable) {
    return {
      stage: 'live-tool-observation',
      attempted: false,
      observed: false,
      warningOnly: true,
      reason: 'skipped-without-reachability',
    };
  }

  if (!toolsAvailable) {
    return {
      stage: 'live-tool-observation',
      attempted: true,
      observed: false,
      warningOnly: true,
      reason: 'unavailable-live-tools',
    };
  }

  return {
    stage: 'live-tool-observation',
    attempted: true,
    observed: true,
    warningOnly: true,
    reason: 'observed-tools',
  };
}

function fixtureJson(value: unknown): string {
  return JSON.stringify(value);
}

describe('Client Conformance Kit internal contract checks', () => {
  it('recognizes the minimum static Atlas discovery shape', () => {
    const result = assessStaticDiscovery({
      kind: 'ok',
      stdout: fixtureJson({
        serverName: 'xurgo-atlas',
        transport: 'streamable-http',
        url: 'http://127.0.0.1:3737/mcp',
        mcpServers: {
          'xurgo-atlas': {
            url: 'http://127.0.0.1:3737/mcp',
          },
        },
      }),
    });

    expect(result).toMatchObject({
      recognized: true,
      warningOnly: true,
      reason: 'recognized',
    });
  });

  it('does not require optional static fields to be present', () => {
    const result = assessStaticDiscovery({
      kind: 'ok',
      stdout: fixtureJson({
        serverName: 'xurgo-atlas',
        transport: 'streamable-http',
        url: 'http://atlas.example/mcp',
        mcpServers: {
          'xurgo-atlas': {
            url: 'http://atlas.example/mcp',
          },
        },
      }),
    });

    const config = result.config as Record<string, unknown>;

    expect(result.recognized).toBe(true);
    expect(config.version).toBeUndefined();
    expect(config.capabilities).toBeUndefined();
    expect(config.tools).toBeUndefined();
    expect((config.mcpServers as Record<string, unknown>)['xurgo-atlas']).not.toHaveProperty('type');
  });

  it('accepts unresolved project fields as non-blocking static recognition', () => {
    const result = assessStaticDiscovery({
      kind: 'ok',
      stdout: fixtureJson({
        serverName: 'xurgo-atlas',
        transport: 'streamable-http',
        url: 'http://127.0.0.1:3737/mcp',
        projectId: null,
        projectRoot: null,
        registeredProjectRoot: null,
        mcpServers: {
          'xurgo-atlas': {
            url: 'http://127.0.0.1:3737/mcp',
          },
        },
      }),
    });

    expect(result.recognized).toBe(true);
    expect(result.warningOnly).toBe(true);
  });

  it('does not require safeForWrites for static recognition', () => {
    const result = assessStaticDiscovery({
      kind: 'ok',
      stdout: fixtureJson({
        serverName: 'xurgo-atlas',
        transport: 'streamable-http',
        url: 'http://127.0.0.1:3737/mcp',
        safety: {
          safeForWrites: false,
        },
        mcpServers: {
          'xurgo-atlas': {
            url: 'http://127.0.0.1:3737/mcp',
          },
        },
      }),
    });

    expect(result.recognized).toBe(true);
  });

  it('treats malformed JSON as a warning-only static discovery failure', () => {
    const result = assessStaticDiscovery({
      kind: 'ok',
      stdout: '{"serverName":"xurgo-atlas"',
    });

    expect(result).toMatchObject({
      recognized: false,
      warningOnly: true,
      reason: 'malformed-json',
    });
  });

  it('treats parseable but insufficient JSON as a warning-only static discovery failure', () => {
    const result = assessStaticDiscovery({
      kind: 'ok',
      stdout: fixtureJson({
        serverName: 'xurgo-atlas',
        transport: 'streamable-http',
        mcpServers: {
          'xurgo-atlas': {
            url: '',
          },
        },
      }),
    });

    expect(result).toMatchObject({
      recognized: false,
      warningOnly: true,
      reason: 'insufficient-static-config',
    });
  });

  it('treats a missing CLI as a warning-only static discovery failure', () => {
    const result = assessStaticDiscovery({ kind: 'missing-cli' });
    expect(result).toMatchObject({
      recognized: false,
      warningOnly: true,
      reason: 'missing-cli',
    });
  });

  it('treats a timeout as a warning-only static discovery failure', () => {
    const result = assessStaticDiscovery({ kind: 'timeout' });
    expect(result).toMatchObject({
      recognized: false,
      warningOnly: true,
      reason: 'timeout',
    });
  });

  it('treats a non-zero CLI exit as a warning-only static discovery failure', () => {
    const result = assessStaticDiscovery({
      kind: 'non-zero-exit',
      exitCode: 1,
      stderr: 'boom',
    });

    expect(result).toMatchObject({
      recognized: false,
      warningOnly: true,
      reason: 'non-zero-exit',
    });
  });

  it('keeps daemon reachability separate from static recognition', () => {
    const recognized = assessStaticDiscovery({
      kind: 'ok',
      stdout: fixtureJson({
        serverName: 'xurgo-atlas',
        transport: 'streamable-http',
        url: 'http://127.0.0.1:3737/mcp',
        mcpServers: {
          'xurgo-atlas': {
            url: 'http://127.0.0.1:3737/mcp',
          },
        },
      }),
    });

    const failedConnection = assessDaemonReachability(recognized, false);

    expect(recognized.recognized).toBe(true);
    expect(failedConnection).toEqual({
      stage: 'daemon-reachability',
      attempted: true,
      reachable: false,
      warningOnly: true,
      reason: 'failed-connection',
    });
  });

  it('skips daemon reachability when static recognition already failed', () => {
    const staticFailure = assessStaticDiscovery({ kind: 'missing-cli' });
    const reachability = assessDaemonReachability(staticFailure, false);

    expect(reachability).toEqual({
      stage: 'daemon-reachability',
      attempted: false,
      reachable: false,
      warningOnly: true,
      reason: 'skipped-without-static-recognition',
    });
  });

  it('keeps live tool observation separate from daemon reachability', () => {
    const recognized = assessStaticDiscovery({
      kind: 'ok',
      stdout: fixtureJson({
        serverName: 'xurgo-atlas',
        transport: 'streamable-http',
        url: 'http://127.0.0.1:3737/mcp',
        mcpServers: {
          'xurgo-atlas': {
            url: 'http://127.0.0.1:3737/mcp',
          },
        },
      }),
    });
    const connected = assessDaemonReachability(recognized, true);
    const liveToolsUnavailable = assessLiveToolObservation(connected, false);

    expect(connected.reachable).toBe(true);
    expect(liveToolsUnavailable).toEqual({
      stage: 'live-tool-observation',
      attempted: true,
      observed: false,
      warningOnly: true,
      reason: 'unavailable-live-tools',
    });
  });

  it('skips live tool observation when reachability never succeeded', () => {
    const staticFailure = assessStaticDiscovery({ kind: 'timeout' });
    const reachability = assessDaemonReachability(staticFailure, false);
    const liveTools = assessLiveToolObservation(reachability, false);

    expect(liveTools).toEqual({
      stage: 'live-tool-observation',
      attempted: false,
      observed: false,
      warningOnly: true,
      reason: 'skipped-without-reachability',
    });
  });
});
