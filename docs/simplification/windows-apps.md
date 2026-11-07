# Windows desktop experiences

Status: Planned — awaiting implementation instruction.
Parent: [roadmap](README.md). Required experiences: [D12–D13](decisions.md).

## Purpose and confirmed scope

Provide Windows access for POS, managers/admins and employee attendance, all using the
same ERPNext records and server rules. Simplified screens are primary; advanced native
forms remain available according to permissions in the management experience.

| Experience | Primary task | Connectivity requirement |
| --- | --- | --- |
| POS | Checkout, receipt, returns and shift operation | Preserve required POS offline work and recovery |
| Management | Simplified hubs, reports, setup and permitted advanced forms | Online |
| Attendance | Shared employee PIN check-in/out station | Online |

Three focused experiences are proposed; the owner has not selected three separate
installers versus one package with separate launch modes. Packaging must not decide
access rights. A desktop URL or hidden menu is not a server permission boundary.

## Existing source and reuse assessment

POS Awesome already has `electron/main.js`, `preload.js`, setup/offline fallback pages,
Electron Builder configuration and `scripts/electron_smoke_check.mjs`.
Read [the packaging audit](../../../posawesome/docs/electron/packaging-audit.md) and
inspect current code/scripts before choosing architecture or dependencies.

The inspected main process loads a configured server URL and provides a local offline
fallback. Existing offline POS code does not by itself prove cold-start checkout works
when the server is unreachable. Verify warm disconnect, app restart, cached UI loading,
queued sales and reconnect independently before claiming desktop offline support.

Reuse feasible shell/runtime pieces; do not clone POS into a separate management or
attendance codebase with duplicate finance, PIN or payroll rules. Determine source
ownership for non-POS desktop packaging after the architecture review; this roadmap's
location under ERPNext does not assign all desktop code to ERPNext.

## Proposed capabilities and boundaries

- Simple server connection/setup and appropriate start screen per experience.
- Separate appropriate sessions/storage contexts so attendance cannot inherit a manager
  session and app/server changes cannot mix stores, carts or offline queues.
- Management supports source links, printing/export and permitted advanced forms.
- Attendance gives clear online/unavailable states and returns to the neutral PIN screen;
  no salary/customer/financial information in the kiosk.
- POS preserves barcode scanner focus, printer/fiscal/QZ integrations, offline IndexedDB,
  queue recovery and exactly-once submission. Do not overwrite queues during updates.
- Validate trusted navigation, external links, permissions and minimal preload/IPC
  capabilities before extending the shell. Never expose Node APIs to untrusted pages.
- Plan installation, version display, upgrade/rollback, settings persistence and clear
  connection errors. Signing, update hosting and publication need explicit release scope.

## Phases and verification

| Phase | Work | Completion gate |
| --- | --- | --- |
| W0, early | Inspect existing shell/runtime, target Windows/devices and distribution | Q11 narrowed; installer/mode, storage/session and offline architecture decided |
| W1 | POS desktop hardening/packaging | Real offline/restart/reconnect evidence and hardware expectations met |
| W2 | Management experience | Verified hubs, role scope, advanced links and financial permissions ready |
| W3 | Attendance experience | Online PIN/schedule/correction flow ready; isolation from management verified |
| W4 | Windows installation/upgrade handoff | Installer, update/recovery, documentation and physical-device checks complete |

Each experience may be delivered when ready; Windows work need not wait for every hub.
Test actual Windows install/reinstall/upgrade, server URL changes, restart, invalid
certificate/connection handling, login/logout and separate-app sessions. POS additionally
needs scanner/receipt devices, warm/cold offline behavior and queued-invoice recovery.
Use current scoped Electron scripts; distinguish Linux/static packaging checks from
actual Windows installation and hardware evidence. No installer was built by this plan.
