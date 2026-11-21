import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyToClipboard } from '../clipboard';

const SAMPLE_PAT = `mcp_pat_${'f0e1d2c3'.repeat(8)}`;

interface MockTextarea {
  value: string;
  attributes: Record<string, string>;
  style: { position: string; top: string };
  parent: MockContainer | null;
  setAttribute: (name: string, value: string) => void;
  select: ReturnType<typeof vi.fn>;
  remove: () => void;
}

interface MockContainer {
  children: MockTextarea[];
  appendChild: (node: MockTextarea) => MockTextarea;
}

function createMockContainer(): MockContainer {
  const container: MockContainer = {
    children: [],
    appendChild(node: MockTextarea) {
      node.parent = container;
      container.children.push(node);
      return node;
    },
  };
  return container;
}

function setupMockDom(options: {
  secureContext: boolean;
  writeText?: () => Promise<void>;
  hasOpenDialog?: boolean;
  selectImpl?: () => void;
  execCommandImpl?: () => boolean;
}) {
  const body = createMockContainer();
  const dialog = createMockContainer();
  const createdTextareas: MockTextarea[] = [];

  const createElement = vi.fn((tagName: string): MockTextarea => {
    expect(tagName).toBe('textarea');
    const textarea: MockTextarea = {
      value: '',
      attributes: {},
      style: { position: '', top: '' },
      parent: null,
      setAttribute(name: string, value: string) {
        textarea.attributes[name] = value;
      },
      select: vi.fn(options.selectImpl ?? (() => {})),
      remove() {
        if (textarea.parent) {
          textarea.parent.children = textarea.parent.children.filter((child) => child !== textarea);
          textarea.parent = null;
        }
      },
    };
    createdTextareas.push(textarea);
    return textarea;
  });

  const execCommand = vi.fn(options.execCommandImpl ?? (() => true));
  const querySelectorAll = vi.fn(() => (options.hasOpenDialog ? [dialog] : []));

  vi.stubGlobal('window', { isSecureContext: options.secureContext });
  vi.stubGlobal(
    'navigator',
    options.writeText ? { clipboard: { writeText: vi.fn(options.writeText) } } : {},
  );
  vi.stubGlobal('document', {
    body,
    createElement,
    querySelectorAll,
    execCommand,
  });

  return { body, dialog, createdTextareas, createElement, execCommand };
}

describe('copyToClipboard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses navigator.clipboard.writeText in a secure context without touching DOM', async () => {
    const writeText = vi.fn(async () => {});
    const { createElement } = setupMockDom({
      secureContext: true,
      writeText,
    });

    const result = await copyToClipboard(SAMPLE_PAT);

    expect(result).toBe(true);
    expect(writeText).toHaveBeenCalledWith(SAMPLE_PAT);
    expect(createElement).not.toHaveBeenCalled();
  });

  it('falls back cleanly inside an open dialog when Clipboard API rejects and wipes/removes textarea', async () => {
    const { body, dialog, createdTextareas, execCommand } = setupMockDom({
      secureContext: true,
      writeText: async () => {
        throw new Error('Clipboard permission denied');
      },
      hasOpenDialog: true,
      execCommandImpl: () => true,
    });

    const result = await copyToClipboard(SAMPLE_PAT);

    expect(result).toBe(true);
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(createdTextareas).toHaveLength(1);
    expect(createdTextareas[0]?.value).toBe('');
    expect(createdTextareas[0]?.attributes['readonly']).toBe('');
    expect(createdTextareas[0]?.attributes['aria-hidden']).toBe('true');
    expect(dialog.children).toHaveLength(0);
    expect(body.children).toHaveLength(0);
  });

  it('returns false and removes textarea when execCommand returns false', async () => {
    const { body, createdTextareas } = setupMockDom({
      secureContext: false,
      execCommandImpl: () => false,
    });

    const result = await copyToClipboard(SAMPLE_PAT);

    expect(result).toBe(false);
    expect(createdTextareas).toHaveLength(1);
    expect(createdTextareas[0]?.value).toBe('');
    expect(body.children).toHaveLength(0);
  });

  it('unconditionally clears PAT value and removes textarea when Clipboard API rejects and execCommand throws', async () => {
    const { body, dialog, createdTextareas } = setupMockDom({
      secureContext: true,
      writeText: async () => {
        throw new Error('NotAllowedError');
      },
      hasOpenDialog: true,
      execCommandImpl: () => {
        throw new Error('execCommand failure');
      },
    });

    const result = await copyToClipboard(SAMPLE_PAT);

    expect(result).toBe(false);
    expect(createdTextareas).toHaveLength(1);
    expect(createdTextareas[0]?.value).toBe('');
    expect(dialog.children).toHaveLength(0);
    expect(body.children).toHaveLength(0);
  });

  it('unconditionally clears PAT value and removes textarea when textarea.select() throws', async () => {
    const { body, createdTextareas } = setupMockDom({
      secureContext: true,
      writeText: async () => {
        throw new Error('Clipboard unavailable');
      },
      selectImpl: () => {
        throw new Error('Selection blocked');
      },
    });

    const result = await copyToClipboard(SAMPLE_PAT);

    expect(result).toBe(false);
    expect(createdTextareas).toHaveLength(1);
    expect(createdTextareas[0]?.value).toBe('');
    expect(body.children).toHaveLength(0);
  });
});
