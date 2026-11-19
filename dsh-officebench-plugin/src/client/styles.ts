/**
 * Theme-aligned CSS stylesheet registered via `meta().stylesheets` in the
 * compiled browser plugin bundle. Uses DSH `--dsw-*` semantic tokens so Light
 * and Dark modes match the rest of the Web UI natively.
 *
 * @module dsh-officebench-plugin/client/styles
 */

export const CLIENT_STYLESHEET = `
.ob-page {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 1.5;
}

.ob-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 20px 28px 14px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l4);
  flex: none;
}

.ob-header-title-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.ob-header-title {
  margin: 0;
  font-size: 20px;
  line-height: 28px;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 8px;
}

.ob-header-subtitle {
  margin: 0;
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
}

.ob-dataset-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 10px 28px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l4);
  background: var(--dsw-alias-bg-layer-1, var(--dsw-specific-sidebar-fill));
  flex: none;
}

.ob-dataset-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
}

.ob-input {
  flex: 1 1 260px;
  min-width: 0;
  height: 30px;
  padding: 0 10px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-sm, 8px);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
  box-sizing: border-box;
}

.ob-input:focus {
  outline: none;
  border-color: var(--dsw-alias-state-business-primary);
}

.ob-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border-radius: var(--dsw-radius-sm, 8px);
  border: 0.5px solid var(--dsw-alias-border-l3);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.12s, border-color 0.12s, opacity 0.12s;
}

.ob-btn:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}

.ob-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ob-btn-primary {
  background: var(--dsw-alias-state-business-primary, #4176e6);
  border-color: transparent;
  color: #ffffff;
}

.ob-btn-primary:hover:not(:disabled) {
  filter: brightness(1.06);
  background: var(--dsw-alias-state-business-primary, #4176e6);
}

.ob-btn-danger {
  color: var(--dsw-static-red-500, #ef4444);
}

.ob-btn-sm {
  height: 26px;
  padding: 0 9px;
  font-size: 12px;
}

.ob-caps {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.ob-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 16px;
  font-weight: 500;
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
}

.ob-badge-pass {
  background: rgba(34, 197, 94, 0.14);
  color: var(--dsw-static-green-500, #22c55e);
}

.ob-badge-fail {
  background: rgba(239, 68, 68, 0.14);
  color: var(--dsw-static-red-500, #ef4444);
}

.ob-badge-warn {
  background: rgba(245, 158, 11, 0.14);
  color: var(--dsw-static-amber-500, #f59e0b);
}

.ob-badge-accent {
  background: rgba(65, 118, 230, 0.14);
  color: var(--dsw-alias-state-business-primary, #4176e6);
}

.ob-split {
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}

.ob-list-pane {
  display: flex;
  flex-direction: column;
  flex: 1 1 54%;
  min-width: 0;
  min-height: 0;
  border-right: 0.5px solid var(--dsw-alias-border-l4);
}

.ob-detail-pane {
  display: flex;
  flex-direction: column;
  flex: 1 1 46%;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 20px 24px 32px;
}

@media (max-width: 900px) {
  .ob-split {
    flex-direction: column;
  }
  .ob-list-pane {
    flex: 1 1 50%;
    border-right: 0;
    border-bottom: 0.5px solid var(--dsw-alias-border-l4);
  }
  .ob-detail-pane {
    flex: 1 1 50%;
  }
}

.ob-toolbar {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l4);
  flex: none;
}

.ob-tabs-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.ob-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--dsw-radius-sm, 8px);
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
}

.ob-chip:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.ob-chip-active {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.ob-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px 10px 20px;
}

.ob-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  text-align: left;
  padding: 10px 12px;
  margin-bottom: 2px;
  border: 0;
  border-radius: var(--dsw-radius-md, 10px);
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.ob-row:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.ob-row-selected {
  background: var(--dsw-alias-interactive-bg-hover);
  box-shadow: inset 2px 0 0 var(--dsw-alias-state-business-primary, #4176e6);
}

.ob-row-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.ob-row-key {
  font-family: var(--ds-font-family-code);
  font-size: 12px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}

.ob-row-prompt {
  font-size: 13px;
  color: var(--dsw-alias-label-primary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
}

.ob-row-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
}

.ob-card {
  border: 0.5px solid var(--dsw-alias-border-l4);
  border-radius: var(--dsw-radius-md, 10px);
  background: var(--dsw-alias-bg-layer-1, var(--dsw-specific-sidebar-fill));
  padding: 12px 14px;
  margin-bottom: 12px;
}

.ob-card-title {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--dsw-alias-label-secondary);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.ob-prompt-box {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--dsw-alias-label-primary);
}

.ob-actions-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 12px 0 16px;
}

.ob-kv-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 8px 12px;
  font-size: 12px;
}

.ob-kv-label {
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
}

.ob-kv-val {
  color: var(--dsw-alias-label-primary);
  font-weight: 500;
}

.ob-file-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ob-file-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--dsw-radius-sm, 8px);
  font-size: 12px;
}

.ob-file-item:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.ob-file-path {
  font-family: var(--ds-font-family-code);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex: 1;
}

.ob-rule-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border-radius: var(--dsw-radius-sm, 8px);
  border: 0.5px solid var(--dsw-alias-border-l4);
  background: var(--dsw-alias-bg-base);
  margin-bottom: 6px;
}

.ob-rule-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
}

.ob-rule-pass {
  color: var(--dsw-static-green-500, #22c55e);
}

.ob-rule-fail {
  color: var(--dsw-static-red-500, #ef4444);
}

.ob-rule-msg {
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  overflow-wrap: anywhere;
}

.ob-rule-args {
  margin: 0;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-1, var(--dsw-specific-sidebar-fill));
  font-family: var(--ds-font-family-code);
  font-size: 11px;
  overflow-x: auto;
  color: var(--dsw-alias-label-tertiary);
}

.ob-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 36px 20px;
  text-align: center;
  color: var(--dsw-alias-label-tertiary);
  font-size: 13px;
}

.ob-error-banner {
  padding: 8px 12px;
  border-radius: var(--dsw-radius-sm, 8px);
  background: rgba(239, 68, 68, 0.1);
  color: var(--dsw-static-red-500, #ef4444);
  font-size: 12px;
  margin-bottom: 10px;
  overflow-wrap: anywhere;
}

.ob-inspector {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
}

.ob-inspector-head {
  padding: 12px 14px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l4);
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: none;
}

.ob-inspector-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.ob-inspector-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l4);
  flex: none;
  overflow-x: auto;
}

.ob-inspector-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 14px 24px;
}

.ob-verdict {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--dsw-radius-md, 10px);
  margin-bottom: 12px;
  font-weight: 600;
}

.ob-verdict-pass {
  background: rgba(34, 197, 94, 0.12);
  color: var(--dsw-static-green-500, #22c55e);
}

.ob-verdict-fail {
  background: rgba(239, 68, 68, 0.12);
  color: var(--dsw-static-red-500, #ef4444);
}

.ob-header-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 9px;
  border-radius: 999px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
}

.ob-header-pill:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.ob-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: none;
  background: var(--dsw-alias-label-tertiary);
}

.ob-dot-pass {
  background: var(--dsw-static-green-500, #22c55e);
}

.ob-dot-fail {
  background: var(--dsw-static-red-500, #ef4444);
}

.ob-tool-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px 0;
  font-size: 13px;
}

.ob-tool-head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.ob-tool-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  padding: 2px 4px;
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
}

.ob-tool-toggle:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.ob-tool-summary {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
}

.ob-tool-file-btn {
  border: 0;
  background: transparent;
  color: var(--dsw-alias-state-business-primary, #4176e6);
  font-family: var(--ds-font-family-code);
  font-size: 11px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  white-space: nowrap;
}

.ob-tool-file-btn:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  text-decoration: underline;
}

.ob-tool-details {
  margin-left: 14px;
  padding: 8px 10px;
  border-left: 1.5px solid var(--dsw-alias-border-l3);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ob-tool-pre {
  margin: 0;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-1, var(--dsw-specific-sidebar-fill));
  font-family: var(--ds-font-family-code);
  font-size: 11px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 220px;
  overflow: auto;
  color: var(--dsw-alias-label-secondary);
}

.ob-tab-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
`
