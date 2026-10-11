import './ui.css';
import {
  defaultCodingAgentsConfig,
  defaultProviderConfig,
  isPermissionMode,
  isToolPermission,
  type CodingAgentsConfig,
  type PermissionMode,
  type ProviderConfig,
  type ToolPermission,
} from '../../../shared/coding-agents';
import {
  AGENT_EFFORTS,
  AGENT_PROVIDERS,
  providerMeta,
  type AgentEffort,
  type AgentProvider,
} from '../../../shared/providers';
import type { Net } from '../../net';
import { store } from '../../state';
import { h, openModal, timeAgo } from '../../ui/dom';

export function openCodingAgents(net: Net, initialProvider: AgentProvider = 'claude') {
  let draft: CodingAgentsConfig = structuredClone(store.codingAgents.config ?? {});
  for (const p of AGENT_PROVIDERS) {
    if (!draft[p]) draft[p] = defaultProviderConfig(p);
  }
  let activeProvider: AgentProvider = initialProvider;

  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const scopeTag = h('span.scope.office', { title: 'Applied to everyone in this office' }, 'Everyone (This office)');
  const header = h('header', {}, h('h2', {}, '🤖 Coding Agents Configuration & Permissions', scopeTag), close);

  const sidebar = h('nav.ca-sidebar', { role: 'tablist', 'aria-label': 'Coding Agents' });
  const content = h('div.ca-content');

  const saveBtn = h('button.btn.primary', { type: 'button' }, 'Save changes');
  const resetBtn = h('button.btn', { type: 'button' }, 'Reset to defaults');
  const footerNote = h('span.ca-footer-info');
  const footer = h('footer.ca-footer', {}, footerNote, h('div.ca-footer-actions', {}, resetBtn, saveBtn));

  const body = h('div.ca-container', {}, sidebar, content);
  const el = h('div.modal.coding-agents', { role: 'dialog', 'aria-label': 'Coding Agents' }, header, body, footer);

  const isDirty = () => {
    return JSON.stringify(draft) !== JSON.stringify(store.codingAgents.config ?? {});
  };

  const getCfg = (p: AgentProvider): ProviderConfig => {
    if (!draft[p]) draft[p] = defaultProviderConfig(p);
    return draft[p]!;
  };

  const paintSidebar = () => {
    sidebar.replaceChildren(
      ...AGENT_PROVIDERS.map((p) => {
        const meta = providerMeta(p);
        const cfg = getCfg(p);
        const active = p === activeProvider;

        const enabledPill = h(
          'span.ca-pill',
          { class: cfg.enabled ? 'enabled' : 'disabled' },
          cfg.enabled ? 'Enabled' : 'Disabled',
        );

        const modePill =
          cfg.permissionMode === 'auto-approve'
            ? h('span.ca-pill.mode-auto', {}, 'Auto')
            : cfg.permissionMode === 'restricted'
              ? h('span.ca-pill.mode-restricted', {}, 'Plan')
              : null;

        const item = h(
          'button.ca-nav-item',
          {
            type: 'button',
            role: 'tab',
            'aria-selected': String(active),
            class: active ? 'active' : '',
            onclick: () => {
              if (activeProvider !== p) {
                activeProvider = p;
                paintSidebar();
                paintContent();
              }
            },
          },
          h('div.ca-nav-title', {}, meta?.label ?? p, h('div.ca-nav-pills', {}, modePill, enabledPill)),
        );
        return item;
      }),
    );
  };

  const paintContent = () => {
    const admin = store.me.admin;
    const meta = providerMeta(activeProvider);
    const cfg = getCfg(activeProvider);

    // Section 1: Access
    const enabledInput = h('input', { type: 'checkbox', disabled: !admin }) as HTMLInputElement;
    enabledInput.checked = cfg.enabled;
    enabledInput.addEventListener('change', () => {
      cfg.enabled = enabledInput.checked;
      paintSidebar();
      paintFooter();
    });
    const accessSec = h(
      'div.ca-section',
      {},
      h('h4.ca-section-title', {}, 'Access Control'),
      h('label.ca-toggle-label', {}, enabledInput, `Allow ${meta?.label ?? activeProvider} workers in this office`),
      h(
        'p.ca-header-desc',
        {},
        cfg.enabled
          ? 'Workers and tasks can select and run with this provider.'
          : 'Hiring or running tasks with this provider is blocked across all desks and queues in this office.',
      ),
    );

    // Section 2: Permission Mode
    const modeSeg = h('div.ca-seg', { role: 'radiogroup', 'aria-label': 'Permission Mode' });
    const modes: [PermissionMode, string, string][] = [
      ['default', '🟢 Interactive', 'Prompts for confirmation in the worker terminal as normal'],
      ['auto-approve', '⚡ Auto-approve', 'Autonomous mode: bypasses approvals (Claude --dangerously-skip-permissions, Codex never ask, OpenCode allow)'],
      ['restricted', '🔒 Restricted (Read-only)', 'Restricts worker to read-only tools and planning mode'],
    ];

    modeSeg.replaceChildren(
      ...modes.map(([m, label, desc]) => {
        const on = cfg.permissionMode === m;
        return h(
          'button.btn',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(on),
            class: on ? 'on' : '',
            disabled: !admin,
            title: desc,
            onclick: () => {
              if (cfg.permissionMode !== m) {
                cfg.permissionMode = m;
                paintContent();
                paintSidebar();
                paintFooter();
              }
            },
          },
          label,
        );
      }),
    );

    // Tool Permissions
    const toolGrid = h('div.ca-tool-grid');
    const tools: [keyof NonNullable<ProviderConfig['tools']>, string][] = [
      ['bash', 'Command / Shell Execution'],
      ['edit', 'File Edits & Writes'],
      ['web', 'Web & Network Access'],
    ];

    const currentTools = cfg.tools ?? { bash: 'ask', edit: 'ask', web: 'ask' };
    cfg.tools = currentTools;

    for (const [toolKey, label] of tools) {
      const select = h('select', { disabled: !admin }) as HTMLSelectElement;
      for (const val of ['allow', 'ask', 'deny'] as const) {
        const opt = h('option', { value: val }, val.toUpperCase());
        if (currentTools[toolKey] === val) opt.selected = true;
        select.append(opt);
      }
      select.addEventListener('change', () => {
        if (isToolPermission(select.value)) {
          currentTools[toolKey] = select.value as ToolPermission;
          paintFooter();
        }
      });
      toolGrid.append(h('div.ca-tool-card', {}, h('span.ca-tool-title', {}, label), select));
    }

    const permSec = h(
      'div.ca-section',
      {},
      h('h4.ca-section-title', {}, 'Execution & Permission Profile'),
      modeSeg,
      h('h5', { style: 'margin: 8px 0 2px 0; font-size: 0.85rem;' }, 'Granular Tool Permissions'),
      toolGrid,
    );

    // Section 3: Office Defaults
    const modelInput = h('input', {
      type: 'text',
      placeholder: meta?.models?.unset ?? 'Provider default',
      disabled: !admin,
    }) as HTMLInputElement;
    modelInput.value = cfg.model ?? '';
    modelInput.addEventListener('input', () => {
      cfg.model = modelInput.value.trim() || undefined;
      paintFooter();
    });

    const effortSelect = h('select', { disabled: !admin || !meta?.takesEffort }) as HTMLSelectElement;
    effortSelect.append(h('option', { value: '' }, 'Default (Provider setting)'));
    for (const eff of AGENT_EFFORTS) {
      const opt = h('option', { value: eff }, eff);
      if (cfg.effort === eff) opt.selected = true;
      effortSelect.append(opt);
    }
    effortSelect.addEventListener('change', () => {
      cfg.effort = (effortSelect.value as AgentEffort) || undefined;
      paintFooter();
    });

    const defaultsSec = h(
      'div.ca-section',
      {},
      h('h4.ca-section-title', {}, 'Office Defaults'),
      h(
        'div.ca-inputs-grid',
        {},
        h('div.ca-field', {}, h('label', {}, 'Default Model (when unselected)'), modelInput),
        h('div.ca-field', {}, h('label', {}, 'Default Reasoning Effort'), effortSelect),
      ),
    );

    // Section 4: Arguments & Env
    const argsInput = h('input', {
      type: 'text',
      placeholder: 'e.g. --verbose --max-turns 50',
      disabled: !admin,
    }) as HTMLInputElement;
    argsInput.value = (cfg.extraArgs ?? []).join(' ');
    argsInput.addEventListener('input', () => {
      const parts = argsInput.value.trim().split(/\s+/).filter(Boolean);
      cfg.extraArgs = parts.length > 0 ? parts : undefined;
      paintFooter();
    });

    const envArea = h('textarea', {
      rows: '3',
      placeholder: 'API_KEY=xxx\nBASE_URL=https://...',
      disabled: !admin,
    }) as HTMLTextAreaElement;
    if (cfg.env) {
      envArea.value = Object.entries(cfg.env)
        .map(([k, v]) => `${k}=${v}`)
        .join('\n');
    }
    envArea.addEventListener('input', () => {
      const envObj: Record<string, string> = {};
      for (const line of envArea.value.split('\n')) {
        const idx = line.indexOf('=');
        if (idx > 0) {
          const k = line.slice(0, idx).trim();
          const v = line.slice(idx + 1).trim();
          if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) envObj[k] = v;
        }
      }
      cfg.env = Object.keys(envObj).length > 0 ? envObj : undefined;
      paintFooter();
    });

    const launchSec = h(
      'div.ca-section',
      {},
      h('h4.ca-section-title', {}, 'Launch Arguments & Environment Variables'),
      h('div.ca-field', {}, h('label', {}, 'Extra CLI Arguments'), argsInput),
      h(
        'div.ca-field',
        { style: 'margin-top: 8px;' },
        h('label', {}, 'Custom Environment Variables (KEY=value per line)'),
        envArea,
      ),
    );

    content.replaceChildren(
      h(
        'div',
        {},
        h('h3', { style: 'margin: 0;' }, meta?.label ?? activeProvider),
        h('p.ca-header-desc', {}, `Executable: ${meta?.bin ?? 'custom'} · Configured specifically for this office`),
      ),
      accessSec,
      permSec,
      defaultsSec,
      launchSec,
    );
  };

  const paintFooter = () => {
    const admin = store.me.admin;
    const dirty = isDirty();
    saveBtn.disabled = !admin || !dirty;
    resetBtn.disabled = !admin;

    const { by, at } = store.codingAgents;
    if (!admin) {
      footerNote.textContent = 'Only office admins can modify coding agent configuration.';
    } else if (dirty) {
      footerNote.textContent = 'Unsaved changes ready to apply across this office.';
    } else if (by && at) {
      footerNote.textContent = `Saved by ${by} ${timeAgo(at)}. Applied to all launching workers in this office.`;
    } else {
      footerNote.textContent = 'Configured per office (.agent-office/coding-agents.json). Applied to all workers.';
    }
  };

  saveBtn.addEventListener('click', () => {
    net.send({ t: 'codingAgents.set', config: draft });
  });

  resetBtn.addEventListener('click', () => {
    draft = defaultCodingAgentsConfig();
    net.send({ t: 'codingAgents.reset' });
  });

  const sync = () => {
    draft = structuredClone(store.codingAgents.config ?? {});
    for (const p of AGENT_PROVIDERS) {
      if (!draft[p]) draft[p] = defaultProviderConfig(p);
    }
    paintSidebar();
    paintContent();
    paintFooter();
  };

  const off = [store.on('codingAgents', sync), store.on('me', sync)];

  const modal = openModal(el, {
    doing: '🤖 in coding agents configuration',
    onClose: () => {
      off.forEach((f) => f());
    },
  });

  close.addEventListener('click', () => modal.close());

  paintSidebar();
  paintContent();
  paintFooter();
}

export function codingAgentsSetting(net: Net) {
  const element = h(
    'div.setting.ca-card-setting',
    {},
    h('div.setting-head', {}, h('h4', {}, 'Coding Agents Configuration & Permissions'), h('span.scope.office', {}, 'Everyone')),
  );
  const btn = h('button.btn.primary', { type: 'button' }, '🤖 Configure coding agents…');
  btn.addEventListener('click', () => openCodingAgents(net));
  const note = h(
    'p.setting-note',
    {},
    'Configure access control, autonomous / auto-approve modes, read-only permissions, and launch arguments for OpenCode, Claude Code, Codex and all available coding agents in this office.',
  );
  element.append(btn, note);
  return { element, dispose: () => {} };
}
