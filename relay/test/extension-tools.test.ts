import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  addActivity: vi.fn(async () => undefined),
  callPage: vi.fn(),
  ensureSiteAccess: vi.fn(async () => undefined),
  readWithSiteReader: vi.fn(async () => null),
  touchAgent: vi.fn(async () => undefined),
}));

vi.mock('../../extension/public/lib/agent-groups.js', () => ({ addToAgentGroup: vi.fn() }));
vi.mock('../../extension/public/lib/page.js', () => ({ callPage: mocks.callPage, waitForLoad: vi.fn() }));
vi.mock('../../extension/public/lib/permissions.js', () => ({
  ensureSiteAccess: mocks.ensureSiteAccess,
  isRestrictedUrl: vi.fn(() => false),
  ToolError: class ToolError extends Error {},
}));
vi.mock('../../extension/public/lib/readers.js', () => ({ readWithSiteReader: mocks.readWithSiteReader }));
vi.mock('../../extension/public/lib/store.js', () => ({
  addActivity: mocks.addActivity,
  getSession: vi.fn(async (_key: string, fallback: unknown) => fallback),
  getSettings: vi.fn(async () => ({ paused: false })),
  getSites: vi.fn(async () => ({ blocked: [] })),
  siteOf: vi.fn((url: string) => new URL(url).hostname),
  touchAgent: mocks.touchAgent,
}));

import { BROWSER_TOOLS, parseToolArgs } from '../src/core/tools.js';
// The extension runtime is plain JavaScript and intentionally has no TypeScript declaration surface.
// @ts-expect-error importing the runtime entrypoint is the behavior under test
import { runTool } from '../../extension/public/lib/tools.js';

const agent = { id: 'agent-1', label: 'Test agent', access: 'read' };
const body = {
  title: 'Example',
  url: 'https://example.com/page',
  text: 'Actual page body',
  truncated: false,
  lang: 'en',
  description: 'Example product — 110,00 €',
  elements: [],
  elementsTotal: 0,
};

function installChrome(tabs: Array<Record<string, unknown>>, capture = vi.fn(async () => 'data:image/jpeg;base64,cGl4ZWxz')) {
  const byId = new Map(tabs.map((tab) => [tab.id, { ...tab }]));
  const chrome = {
    tabs: {
      get: vi.fn(async (id: number) => {
        const tab = byId.get(id);
        if (!tab) throw new Error('missing tab');
        return { ...tab };
      }),
      query: vi.fn(async ({ active, windowId, lastFocusedWindow }: Record<string, unknown>) =>
        [...byId.values()]
          .filter((tab) => (!active || tab.active) && (windowId === undefined || tab.windowId === windowId))
          .filter((tab) => !lastFocusedWindow || tab.windowId === 1)
          .map((tab) => ({ ...tab }))
      ),
      update: vi.fn(async (id: number, update: Record<string, unknown>) => {
        const tab = byId.get(id);
        if (!tab) throw new Error('missing tab');
        if (update.active) {
          for (const candidate of byId.values()) {
            if (candidate.windowId === tab.windowId) candidate.active = false;
          }
        }
        Object.assign(tab, update);
        return { ...tab };
      }),
      captureVisibleTab: capture,
    },
    windows: { get: vi.fn(async () => ({ state: 'normal' })) },
  };
  vi.stubGlobal('chrome', chrome);
  return { byId, chrome, capture };
}

describe('extension read_page visual evidence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readWithSiteReader.mockResolvedValue(null);
    mocks.callPage.mockImplementation(async (_tabId: number, method: string) => {
      if (method === 'readPage') return body;
      if (method === 'extractDesign') return { title: body.title, url: body.url, colors: [{ value: '#fff' }] };
      throw new Error(`unexpected method ${method}`);
    });
  });

  it('keeps visuals off by default and validates the additive flag', async () => {
    const { capture } = installChrome([{ id: 7, windowId: 1, active: true, title: body.title, url: body.url }]);
    const tool = BROWSER_TOOLS.find((candidate) => candidate.name === 'read_page')!;
    expect(parseToolArgs(tool, { tabId: 7, includeVisuals: true })).toMatchObject({
      ok: true,
      args: { tabId: 7, includeVisuals: true },
    });
    expect(parseToolArgs(tool, { tabId: 7, includeHtml: true })).toMatchObject({
      ok: true,
      args: { tabId: 7, includeHtml: true },
    });

    const result = await runTool(agent, 'read_page', { tabId: 7 });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].text).toContain('Actual page body');
    expect(result.content[0].text).not.toContain('htmlTruncated');
    expect(capture).not.toHaveBeenCalled();
    expect(mocks.callPage).toHaveBeenCalledTimes(1);
  });

  it('returns HTML independently without design extraction or screenshot capture', async () => {
    const { capture } = installChrome([{ id: 7, windowId: 1, active: true, title: body.title, url: body.url }]);
    mocks.callPage.mockImplementation(async (_tabId: number, method: string, args: Record<string, unknown>) => {
      if (method === 'readPage') {
        expect(args.includeHtml).toBe(true);
        return { ...body, html: '<main><h1>Example</h1></main>', htmlTruncated: false };
      }
      throw new Error(`unexpected method ${method}`);
    });

    const result = await runTool(agent, 'read_page', { tabId: 7, includeHtml: true });
    const envelope = JSON.parse(result.content[0].text);
    expect(result.content).toHaveLength(1);
    expect(envelope.html).toBe('<main><h1>Example</h1></main>');
    expect(envelope.htmlTruncated).toBe(false);
    expect(envelope.description).toBe(body.description);
    expect(envelope.design).toBeUndefined();
    expect(capture).not.toHaveBeenCalled();
  });

  it('preserves interactive refs in an HTML evidence envelope', async () => {
    const { capture } = installChrome([{ id: 7, windowId: 1, active: true, title: body.title, url: body.url }]);
    mocks.callPage.mockResolvedValue({
      ...body,
      html: '<main><button>Buy</button></main>',
      htmlTruncated: false,
      elements: ['[4] button "Buy"'],
      elementsTotal: 1,
    });

    const result = await runTool(agent, 'read_page', { tabId: 7, includeHtml: true, interactive: true });
    const envelope = JSON.parse(result.content[0].text);
    expect(envelope.elements).toEqual(['[4] button "Buy"']);
    expect(envelope.elementsTotal).toBe(1);
    expect(envelope.html).toContain('<button>Buy</button>');
    expect(capture).not.toHaveBeenCalled();
  });

  it('returns facts and design first, followed by genuine screenshot pixels', async () => {
    installChrome([{ id: 7, windowId: 1, active: true, title: body.title, url: body.url }]);
    const result = await runTool(agent, 'read_page', { tabId: 7, includeVisuals: true });
    const envelope = JSON.parse(result.content[0].text);

    expect(envelope).toEqual({
      kind: 'tabpass.page',
      version: 1,
      tabId: 7,
      url: body.url,
      title: body.title,
      description: body.description,
      text: body.text,
      truncated: false,
      design: { title: body.title, url: body.url, colors: [{ value: '#fff' }] },
    });
    expect(result.content[1]).toEqual({ type: 'image', data: 'cGl4ZWxz', mimeType: 'image/jpeg' });
  });

  it('preserves page facts when screenshot capture fails', async () => {
    installChrome(
      [{ id: 7, windowId: 1, active: true, title: body.title, url: body.url }],
      vi.fn(async () => {
        throw new Error('capture failed');
      })
    );
    const result = await runTool(agent, 'read_page', { tabId: 7, includeVisuals: true });
    const envelope = JSON.parse(result.content[0].text);

    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);
    expect(envelope.text).toBe(body.text);
    expect(envelope.design.colors).toEqual([{ value: '#fff' }]);
    expect(envelope.visualError).toContain('capture failed');
  });

  it('preserves page facts and screenshot pixels when design extraction fails', async () => {
    installChrome([{ id: 7, windowId: 1, active: true, title: body.title, url: body.url }]);
    mocks.callPage.mockImplementation(async (_tabId: number, method: string) => {
      if (method === 'readPage') return body;
      if (method === 'extractDesign') throw new Error('design failed');
      throw new Error(`unexpected method ${method}`);
    });

    const result = await runTool(agent, 'read_page', { tabId: 7, includeVisuals: true });
    const envelope = JSON.parse(result.content[0].text);
    expect(result.isError).toBeUndefined();
    expect(envelope.text).toBe(body.text);
    expect(envelope.design).toBeUndefined();
    expect(envelope.visualError).toContain('design failed');
    expect(result.content[1]).toEqual({ type: 'image', data: 'cGl4ZWxz', mimeType: 'image/jpeg' });
  });

  it('uses the Google special-reader text in the visual evidence bundle', async () => {
    installChrome([{ id: 7, windowId: 1, active: true, title: body.title, url: body.url }]);
    mocks.readWithSiteReader.mockResolvedValue({ kind: 'Google Doc (Markdown export)', text: 'special-reader-body' } as never);

    const result = await runTool(agent, 'read_page', { tabId: 7, includeVisuals: true, maxChars: 7 });
    const envelope = JSON.parse(result.content[0].text);
    expect(envelope.text).toBe('special');
    expect(envelope.truncated).toBe(true);
    expect(mocks.callPage.mock.calls.some(([, method]) => method === 'readPage')).toBe(false);
    expect(mocks.callPage.mock.calls.some(([, method]) => method === 'extractDesign')).toBe(true);
    expect(result.content[1].type).toBe('image');
  });

  it('combines Google special-reader text with structural HTML without a capture', async () => {
    const { capture } = installChrome([{ id: 7, windowId: 1, active: true, title: body.title, url: body.url }]);
    mocks.readWithSiteReader.mockResolvedValue({ kind: 'Google Doc (Markdown export)', text: 'exported document body' } as never);
    mocks.callPage.mockResolvedValue({ ...body, html: '<main>visible canvas shell</main>', htmlTruncated: true });

    const result = await runTool(agent, 'read_page', { tabId: 7, includeHtml: true, maxChars: 8 });
    const envelope = JSON.parse(result.content[0].text);
    expect(envelope.text).toBe('exported');
    expect(envelope.truncated).toBe(true);
    expect(envelope.html).toBe('<main>visible canvas shell</main>');
    expect(envelope.htmlTruncated).toBe(true);
    expect(mocks.callPage).toHaveBeenCalledWith(7, 'readPage', { maxChars: 1000, includeHtml: true });
    expect(capture).not.toHaveBeenCalled();
  });

  it('stops before the design read when the page changed after the body read', async () => {
    const { byId, capture } = installChrome([{ id: 7, windowId: 1, active: true, title: body.title, url: body.url }]);
    mocks.callPage.mockImplementation(async (_tabId: number, method: string) => {
      if (method === 'readPage') {
        byId.get(7)!.url = 'https://example.com/changed';
        return body;
      }
      if (method === 'extractDesign') throw new Error('must not be called');
      throw new Error(`unexpected method ${method}`);
    });

    const result = await runTool(agent, 'read_page', { tabId: 7, includeVisuals: true });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('page changed while it was being read');
    expect(mocks.callPage.mock.calls.map(([, method]) => method)).toEqual(['readPage']);
    expect(capture).not.toHaveBeenCalled();
  });

  it('restores the prior active tab even when a standalone capture fails', async () => {
    const { byId } = installChrome(
      [
        { id: 7, windowId: 1, active: false, title: body.title, url: body.url },
        { id: 8, windowId: 1, active: true, title: 'Current', url: 'https://current.example/' },
      ],
      vi.fn(async () => {
        throw new Error('capture failed');
      })
    );
    const result = await runTool(agent, 'screenshot', { tabId: 7 });

    expect(result.isError).toBe(true);
    expect(byId.get(8)?.active).toBe(true);
    expect(byId.get(7)?.active).toBe(false);
  });

  it('does not attribute pixels to a page that navigated after the read', async () => {
    const { byId, capture } = installChrome([{ id: 7, windowId: 1, active: true, title: body.title, url: body.url }]);
    mocks.callPage.mockImplementation(async (_tabId: number, method: string) => {
      if (method === 'readPage') return body;
      if (method === 'extractDesign') {
        byId.get(7)!.url = 'https://example.com/next';
        return { title: body.title, url: body.url };
      }
      throw new Error(`unexpected method ${method}`);
    });

    const result = await runTool(agent, 'read_page', { tabId: 7, includeVisuals: true });
    const envelope = JSON.parse(result.content[0].text);
    expect(result.content).toHaveLength(1);
    expect(envelope.visualError).toContain('navigated after it was read');
    expect(capture).not.toHaveBeenCalled();
  });

  it('rejects pixels when the page navigates during capture', async () => {
    let byId!: Map<unknown, Record<string, unknown>>;
    const capture = vi.fn(async () => {
      byId.get(7)!.url = 'https://example.com/during-capture';
      return 'data:image/jpeg;base64,cGl4ZWxz';
    });
    ({ byId } = installChrome([{ id: 7, windowId: 1, active: true, title: body.title, url: body.url }], capture));

    const result = await runTool(agent, 'screenshot', { tabId: 7 });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('changed during capture');
  });

  it('rejects pixels when another tab becomes active during capture', async () => {
    let byId!: Map<unknown, Record<string, unknown>>;
    const capture = vi.fn(async () => {
      byId.get(7)!.active = false;
      byId.get(8)!.active = true;
      return 'data:image/jpeg;base64,cGl4ZWxz';
    });
    ({ byId } = installChrome(
      [
        { id: 7, windowId: 1, active: true, title: body.title, url: body.url },
        { id: 8, windowId: 1, active: false, title: 'Other', url: 'https://other.example/' },
      ],
      capture
    ));

    const result = await runTool(agent, 'screenshot', { tabId: 7 });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('active tab changed during capture');
  });

  it('serializes captures and spaces an active capture after a background-tab capture', async () => {
    let captures = 0;
    let maxCaptures = 0;
    const starts: number[] = [];
    const capture = vi.fn(async () => {
      captures += 1;
      maxCaptures = Math.max(maxCaptures, captures);
      starts.push(Date.now());
      await new Promise((resolve) => setTimeout(resolve, 20));
      captures -= 1;
      return 'data:image/jpeg;base64,cGl4ZWxz';
    });
    installChrome(
      [
        { id: 7, windowId: 1, active: false, title: body.title, url: body.url },
        { id: 9, windowId: 1, active: true, title: 'Second', url: 'https://second.example/' },
      ],
      capture
    );

    const [first, second] = await Promise.all([
      runTool(agent, 'screenshot', { tabId: 7 }),
      runTool(agent, 'screenshot', { tabId: 9 }),
    ]);
    expect(first.isError).toBeUndefined();
    expect(second.isError).toBeUndefined();
    expect(maxCaptures).toBe(1);
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(540);
  });

  it('rejects new capture work when the six-slot queue is full', async () => {
    let releaseFirst!: (value: string) => void;
    let captureCount = 0;
    const capture = vi.fn(async () => {
      captureCount += 1;
      if (captureCount === 1) {
        return new Promise<string>((resolve) => {
          releaseFirst = resolve;
        });
      }
      return 'data:image/jpeg;base64,cGl4ZWxz';
    });
    installChrome([{ id: 7, windowId: 1, active: true, title: body.title, url: body.url }], capture);

    const accepted = Array.from({ length: 6 }, () => runTool(agent, 'screenshot', { tabId: 7 }));
    await vi.waitFor(() => expect(capture).toHaveBeenCalledTimes(1));
    const overflow = await runTool(agent, 'screenshot', { tabId: 7 });
    expect(overflow.isError).toBe(true);
    expect(overflow.content[0].text).toContain('Screenshot queue is full');

    releaseFirst('data:image/jpeg;base64,cGl4ZWxz');
    const completed = await Promise.all(accepted);
    expect(completed.every((result: { isError?: boolean }) => result.isError === undefined)).toBe(true);
  });
});
