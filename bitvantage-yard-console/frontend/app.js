const IS_LOCAL = ["127.0.0.1", "localhost"].includes(window.location.hostname);
const API_ORIGIN = IS_LOCAL ? "http://127.0.0.1:8000" : window.location.origin;
const API_BASE_URL = `${API_ORIGIN}/api/containers`;
const API_ROOT = `${API_ORIGIN}/api`;
const STORAGE_TOKEN_KEY = "bitvantage_auth_token";
const STORAGE_USER_KEY = "bitvantage_user";
const STORAGE_SIDEBAR_KEY = "bitvantage_sidebar_collapsed";
const AUTO_REFRESH_MS = 15000;
const MAX_TIER_COUNT = 4;
const DEFAULT_VIEWPORT_SIZE = 14;

const DEFAULT_LAYOUT = [
    { block: "01", bayCount: 10, rowCount: 2, tierCount: MAX_TIER_COUNT, label: "West Rail Block", equipment: "Left of the railway", footprint: "10 x 2" },
    { block: "02", bayCount: 14, rowCount: 6, tierCount: MAX_TIER_COUNT, label: "East Rail Block", equipment: "Right of the railway", footprint: "14 x 6" },
];

const state = {
    authToken: null,
    currentUser: null,
    layoutConfig: [],
    terminalLayout: [],
    slotCatalog: [],
    slotRecordsByBlock: new Map(),
    slotRecordIndex: new Map(),
    inventory: [],
    containerById: new Map(),
    blockContainersIndex: new Map(),
    slotContainersIndex: new Map(),
    surfaceOccupancyByBlock: new Map(),
    logs: [],
    dashboardStats: {
        todayIn: 0,
        todayOut: 0,
    },
    inventorySearchQuery: "",
    reports: {
        filters: {
            dateFrom: "",
            dateTo: "",
            operationType: "",
            operatorQuery: "",
            containerQuery: "",
        },
        items: [],
        summary: null,
        loaded: false,
        loading: false,
    },
    adminUsers: [],
    selectedAdminUser: null,
    selectedAdminBlock: null,
    selectedAdminSlot: null,
    selectedBlock: "01",
    selectedSlotKey: null,
    selectedContainerId: null,
    tierVisibility: "top",
    viewportSize: DEFAULT_VIEWPORT_SIZE,
    rowPage: 0,
    bayPage: 0,
    lastLoadedAt: null,
    autoRefreshTimer: null,
    containerHistory: new Map(),
    routingPreviewCache: new Map(),
    moveDraftContainerId: null,
    draggingContainerId: null,
    dragOverSlotKey: null,
    pendingMove: null,
    toastTimer: null,
    inventoryLoadPromise: null,
    inventoryReloadQueued: false,
    inventoryLoadingVisible: false,
    authBusy: false,
    operationBusyLabel: "",
    busyButtonId: null,
    quickMoveContainerId: null,
    moveTargetDraft: {
        block: "",
        bay: "",
        row: "",
    },
    stackInPositionDirty: false,
    formDirty: {
        stackin: false,
        stackout: false,
        restow: false,
    },
};

function setAuthBusy(isBusy) {
    state.authBusy = isBusy;
    state.busyButtonId = isBusy ? "auth-submit-button" : (state.busyButtonId === "auth-submit-button" ? null : state.busyButtonId);
    renderBusyState();
}

function setOperationBusy(label = "", buttonId = null) {
    state.operationBusyLabel = label;
    state.busyButtonId = label ? buttonId : (state.busyButtonId === buttonId ? null : state.busyButtonId);
    renderBusyState();
}

function renderBusyState() {
    const indicator = document.getElementById("activity-indicator");
    const text = document.getElementById("activity-text");
    const active = Boolean(state.authBusy || state.operationBusyLabel || (state.inventoryLoadPromise && state.inventoryLoadingVisible));
    if (indicator && text) {
        if (active) {
            indicator.classList.remove("hidden");
            text.textContent = state.operationBusyLabel || (state.authBusy ? "Signing in..." : (state.lastLoadedAt ? "Refreshing yard data..." : "Loading terminal data..."));
        } else {
            indicator.classList.add("hidden");
        }
    }

    const logoutButton = document.getElementById("logout-button");
    if (logoutButton) logoutButton.disabled = Boolean(state.authBusy || state.operationBusyLabel);

    const refreshButton = document.getElementById("refresh-dashboard");
    if (refreshButton) refreshButton.disabled = Boolean(state.inventoryLoadPromise);

    ["auth-submit-button", "stackin-submit-button", "stackout-submit-button", "restow-submit-button", "target-move-submit", "confirm-move-button", "reports-refresh", "download-report-csv", "download-report-pdf", "admin-delete-user-button"].forEach((id) => {
        const button = document.getElementById(id);
        if (!button) return;
        const isBusyButton = state.busyButtonId === id;
        button.classList.toggle("is-loading", isBusyButton);
        if (isBusyButton) {
            button.disabled = true;
            button.dataset.busyLocked = "true";
        } else if (button.dataset.busyLocked === "true") {
            button.disabled = false;
            delete button.dataset.busyLocked;
        }
    });
}

document.addEventListener("DOMContentLoaded", async () => {
    setupTabs();
    setupForms();
    setupDashboardActions();
    setupBayGridInteractions();
    setupSidebar();
    setupTargetMoveWidget();
    setupAuth();
    setupSettings();
    setupMoveConfirmation();
    setupAdmin();
    setupReports();
    restoreLocalSession();
    renderBusyState();

    if (state.authToken) {
        const restored = await restoreSession();
        if (!restored) {
            showAuthScreen("Session expired. Sign in again.");
        }
    } else {
        showAuthScreen();
    }
});

function setupTabs() {
    document.querySelectorAll(".nav-links li").forEach((tab) => {
        tab.addEventListener("click", () => openTab(tab.dataset.tab));
    });
}

function setupSidebar() {
    const shell = document.getElementById("app-shell");
    const toggle = document.getElementById("sidebar-toggle");
    if (!shell || !toggle) return;

    const collapsed = localStorage.getItem(STORAGE_SIDEBAR_KEY) === "true";
    shell.classList.toggle("sidebar-collapsed", collapsed);
    toggle.setAttribute("aria-pressed", String(collapsed));

    toggle.addEventListener("click", () => {
        const nextCollapsed = !shell.classList.contains("sidebar-collapsed");
        shell.classList.toggle("sidebar-collapsed", nextCollapsed);
        toggle.setAttribute("aria-pressed", String(nextCollapsed));
        localStorage.setItem(STORAGE_SIDEBAR_KEY, String(nextCollapsed));
    });
}

function openTab(tabId) {
    const fallbackTab = document.getElementById("dashboard-tab");
    const requestedTab = tabId ? document.getElementById(tabId) : null;
    const nextTab = requestedTab || fallbackTab;
    if (!nextTab) return;

    document.querySelectorAll(".tab-content").forEach((section) => {
        section.classList.toggle("active", section.id === nextTab.id);
    });

    document.querySelectorAll(".nav-links li[data-tab]").forEach((item) => {
        item.classList.toggle("active", item.dataset.tab === nextTab.id);
    });

    const content = document.querySelector(".content");
    if (content) content.scrollTop = 0;

    if (nextTab.id === "reports-tab" && state.currentUser?.permissions?.includes("view_audit") && !state.reports.loaded) {
        void loadOperationsReport();
    }

    if (nextTab.id === "admin-tab" && state.currentUser?.permissions?.includes("manage_users") && !state.adminUsers.length) {
        void loadAdminUsers();
    }
}

function resetMoveTargetDraft(row = "", block = "") {
    state.moveTargetDraft = {
        block: block ? String(block) : "",
        bay: "",
        row: row ? String(row) : "",
    };
}

function setupForms() {
    bindFormDirtyTracking("stackin-form", "stackin");
    bindFormDirtyTracking("stackout-form", "stackout");
    bindFormDirtyTracking("restow-form", "restow");
    renderStackInBlockOptions();
    ["in-block", "in-bay", "in-row", "in-tier"].forEach((id) => {
        on(id, "input", () => {
            state.stackInPositionDirty = true;
        });
        on(id, "change", () => {
            state.stackInPositionDirty = true;
        });
    });

    document.getElementById("stackin-form").addEventListener("input", () => {
        renderStackInAdvisory();
    });
    document.getElementById("stackin-form").addEventListener("change", () => {
        renderStackInAdvisory();
    });
    on("stackin-emergency-override", "change", () => {
        renderStackInAdvisory();
    });
    on("stackin-override-reason", "input", () => {
        renderStackInAdvisory();
    });

    document.getElementById("stackin-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const advisory = getStackInAdvisory();
        if (advisory.tone === "error") {
            showToast(advisory.message, "error");
            return;
        }
        if (advisory.requiresOverride && !advisory.overrideChecked) {
            showToast("Emergency override must be enabled for this placement.", "error");
            return;
        }
        if (advisory.requiresOverride && !advisory.overrideReason) {
            showToast("Enter a reason for the emergency override.", "error");
            return;
        }
        await submitForm(event.target, `${API_BASE_URL}/stack-in`, {
            container_id: value("in-id"),
            container_type: selectValue("in-type"),
            status: selectValue("in-status"),
            direction: selectValue("in-direction"),
            bonded: selectValue("in-bonded") === "true",
            stack_out_date: optionalValue("in-stack-out-date"),
            weight: optionalNumberValue("in-weight"),
            commodity: optionalValue("in-commodity"),
            line: optionalValue("in-line"),
            block: value("in-block"),
            bay: value("in-bay"),
            row: numberValue("in-row"),
            tier: numberValue("in-tier"),
            emergency_override: advisory.requiresOverride && advisory.overrideChecked,
            override_reason: advisory.requiresOverride && advisory.overrideChecked ? advisory.overrideReason : null,
        });
    });

    document.getElementById("stackout-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        await submitForm(event.target, `${API_BASE_URL}/stack-out`, {
            container_id: value("out-id"),
        });
    });

    document.getElementById("restow-form").addEventListener("input", () => {
        renderRestowAdvisory();
    });
    document.getElementById("restow-form").addEventListener("change", () => {
        renderRestowAdvisory();
    });
    on("restow-emergency-override", "change", () => {
        renderRestowAdvisory();
    });
    on("restow-override-reason", "input", () => {
        renderRestowAdvisory();
    });

    document.getElementById("restow-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const advisory = getRestowAdvisory();
        if (advisory.tone === "error") {
            showToast(advisory.message, "error");
            return;
        }
        if (advisory.requiresOverride && !advisory.overrideChecked) {
            showToast("Emergency override must be enabled for this move.", "error");
            return;
        }
        if (advisory.requiresOverride && !advisory.overrideReason) {
            showToast("Enter a reason for the emergency override.", "error");
            return;
        }
        await submitForm(event.target, `${API_BASE_URL}/restow`, {
            container_id: value("restow-id"),
            new_block: value("restow-block"),
            new_bay: value("restow-bay"),
            new_row: numberValue("restow-row"),
            new_tier: numberValue("restow-tier"),
            emergency_override: advisory.requiresOverride && advisory.overrideChecked,
            override_reason: advisory.requiresOverride && advisory.overrideChecked ? advisory.overrideReason : null,
        });
    });
}

function bindFormDirtyTracking(formId, key) {
    const form = document.getElementById(formId);
    form.addEventListener("input", () => {
        state.formDirty[key] = true;
    });
    form.addEventListener("change", () => {
        state.formDirty[key] = true;
    });
}

function setupDashboardActions() {
    on("print-inventory", "click", () => window.print());
    on("refresh-dashboard", "click", () => loadInventory());
    on("inventory-search", "input", (event) => {
        state.inventorySearchQuery = event.target.value;
        renderInventoryTable();
    });
    on("tier-visibility", "change", (event) => {
        state.tierVisibility = event.target.value;
        renderDashboard({ stats: false, overview: false, inventory: false, activity: false, liveStatus: false });
    });
    on("viewport-size", "change", (event) => {
        state.viewportSize = Number(event.target.value);
        state.rowPage = 0;
        state.bayPage = 0;
        renderDashboard({ stats: false, overview: false, inventory: false, activity: false, liveStatus: false });
    });
    on("rows-prev", "click", () => {
        state.rowPage = Math.max(0, state.rowPage - 1);
        renderDashboard({ stats: false, overview: false, inventory: false, activity: false, liveStatus: false });
    });
    on("rows-next", "click", () => {
        state.rowPage += 1;
        renderDashboard({ stats: false, overview: false, inventory: false, activity: false, liveStatus: false });
    });
    on("bays-prev", "click", () => {
        state.bayPage = Math.max(0, state.bayPage - 1);
        renderDashboard({ stats: false, overview: false, inventory: false, activity: false, liveStatus: false });
    });
    on("bays-next", "click", () => {
        state.bayPage += 1;
        renderDashboard({ stats: false, overview: false, inventory: false, activity: false, liveStatus: false });
    });
    on("viewport-jump", "submit", (event) => {
        event.preventDefault();
        jumpToSlot();
    });
    on("prefill-stackout", "click", () => {
        if (!state.selectedContainerId) {
            showToast("Select a container on the map first.", "error");
            return;
        }
        setValue("out-id", state.selectedContainerId);
        openTab("stackout-tab");
        showToast(`Stack Out prepared for ${state.selectedContainerId}.`, "success");
    });
    on("prefill-restow", "click", () => {
        if (state.moveDraftContainerId) {
            state.moveDraftContainerId = null;
            resetMoveTargetDraft();
            renderSelectionState(false);
            showToast("Move mode cancelled.", "success");
            return;
        }
        if (!state.selectedContainerId) {
            showToast("Select a container on the map first.", "error");
            return;
        }
        state.moveDraftContainerId = state.selectedContainerId;
        const selectedContainer = findContainerById(state.selectedContainerId);
        resetMoveTargetDraft(selectedContainer?.row_num || "", selectedContainer?.block || state.selectedBlock);
        renderSelectionState(false);
        showToast("Enter target bay and row, then press OK.", "success");
        openTab("dashboard-tab");
    });
}

function setupBayGridInteractions() {
    const bayGrid = document.getElementById("bay-grid");
    if (!bayGrid) return;

    const getCell = (event) => event.target.closest(".slot-cell");

    bayGrid.addEventListener("click", (event) => {
        const cell = getCell(event);
        if (!cell) return;
        const slotKey = resolveInteractiveSlotKey(cell, event);
        if (!slotKey) return;
        handleSlotClick(slotKey, cell.dataset.containerId || null);
    });

    bayGrid.addEventListener("dragstart", (event) => {
        const cell = getCell(event);
        if (!cell || !cell.dataset.containerId) return;
        handleSlotDragStart(event);
    });

    bayGrid.addEventListener("dragend", (event) => {
        const cell = getCell(event);
        if (!cell) return;
        handleSlotDragEnd();
    });

    bayGrid.addEventListener("dragover", (event) => {
        const cell = getCell(event);
        if (!cell) return;
        handleSlotDragOver(event);
    });

    bayGrid.addEventListener("dragleave", (event) => {
        const cell = getCell(event);
        if (!cell) return;
        handleSlotDragLeave(event);
    });

    bayGrid.addEventListener("drop", (event) => {
        const cell = getCell(event);
        if (!cell) return;
        handleSlotDrop(event);
    });
}

function setupTargetMoveWidget() {
    on("target-move-widget", "submit", async (event) => {
        event.preventDefault();
        await submitTargetMove();
    });
    on("target-move-bay", "input", (event) => {
        state.moveTargetDraft.bay = event.target.value;
        renderTargetMoveWidget();
    });
    on("target-move-row", "input", (event) => {
        state.moveTargetDraft.row = event.target.value;
        renderTargetMoveWidget();
    });
}

function setupAuth() {
    on("login-form", "submit", async (event) => {
        event.preventDefault();
        await login(value("login-username"), document.getElementById("login-password").value);
    });
    document.querySelectorAll(".demo-user-btn").forEach((button) => {
        button.addEventListener("click", () => {
            setValue("login-username", button.dataset.username);
            document.getElementById("login-password").value = button.dataset.password;
        });
    });
    on("logout-button", "click", async () => logout());
}

function setupSettings() {
    on("open-settings", "click", openSettingsModal);
    on("close-settings", "click", closeSettingsModal);
    document.querySelectorAll("[data-close-settings='true']").forEach((node) => node.addEventListener("click", closeSettingsModal));
    on("settings-form", "submit", async (event) => {
        event.preventDefault();
        const response = await apiFetch(`${API_ROOT}/users/me/notifications`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                notifications_enabled: checked("settings-notifications-enabled"),
                telegram_notifications_enabled: checked("settings-telegram-enabled"),
                receive_all_movement_alerts: checked("settings-receive-all"),
            }),
        });
        const data = await response.json();
        if (!response.ok) {
            showToast(data.detail || "Failed to save settings.", "error");
            return;
        }
        state.currentUser = data;
        persistUser();
        syncSessionBadge();
        renderNotificationPreview();
        closeSettingsModal();
        showToast("Notification settings saved.", "success");
    });
    on("update-own-password", "click", async () => {
        const response = await apiFetch(`${API_ROOT}/users/me/password`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                current_password: document.getElementById("current-password").value,
                new_password: document.getElementById("new-password").value,
            }),
        });
        const data = await response.json();
        if (!response.ok) {
            showToast(data.detail || "Failed to update password.", "error");
            return;
        }
        document.getElementById("current-password").value = "";
        document.getElementById("new-password").value = "";
        showToast("Your password was updated.", "success");
    });
}

function setupMoveConfirmation() {
    on("close-move-confirm", "click", closeMoveConfirmModal);
    on("cancel-move-confirm", "click", closeMoveConfirmModal);
    document.querySelectorAll("[data-close-move='true']").forEach((node) => node.addEventListener("click", closeMoveConfirmModal));
    on("move-confirm-emergency-override", "change", () => {
        if (!state.pendingMove) return;
        state.pendingMove.emergencyOverride = checked("move-confirm-emergency-override");
        renderMoveConfirmOverridePanel(state.pendingMove);
    });
    on("move-confirm-override-reason", "input", () => {
        if (!state.pendingMove) return;
        state.pendingMove.overrideReason = optionalValue("move-confirm-override-reason");
        renderMoveConfirmOverridePanel(state.pendingMove);
    });
    on("confirm-move-button", "click", async () => {
        if (!state.pendingMove) return;
        const pending = { ...state.pendingMove };
        if (pending.departureRuleConflict) {
            pending.emergencyOverride = checked("move-confirm-emergency-override");
            pending.overrideReason = optionalValue("move-confirm-override-reason");
            if (!pending.emergencyOverride) {
                renderMoveConfirmOverridePanel(pending);
                showToast("Emergency override must be enabled for this move.", "error");
                return;
            }
            if (!pending.overrideReason) {
                renderMoveConfirmOverridePanel(pending);
                showToast("Enter a reason for the emergency override.", "error");
                return;
            }
        }
        closeMoveConfirmModal();
        await executeRestowMove(pending, pending.targetSlotKey, {
            emergencyOverride: Boolean(pending.emergencyOverride),
            overrideReason: pending.overrideReason || null,
        });
    });
}

function setupAdmin() {
    on("create-user-form", "submit", async (event) => {
        event.preventDefault();
        const response = await apiFetch(`${API_ROOT}/admin/users`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                username: value("create-username"),
                full_name: value("create-fullname"),
                password: document.getElementById("create-password").value,
                role: selectValue("create-role"),
                telegram_chat_id: value("create-telegram") || null,
            }),
        });
        const data = await response.json();
        if (!response.ok) {
            showToast(data.detail || "Failed to create user.", "error");
            return;
        }
        event.target.reset();
        await loadAdminUsers();
        showToast(`User ${data.username} created.`, "success");
    });

    on("admin-role-form", "submit", async (event) => {
        event.preventDefault();
        if (!state.selectedAdminUser) return;
        const response = await apiFetch(`${API_ROOT}/admin/users/${state.selectedAdminUser.username}/role`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role: selectValue("admin-role-select") }),
        });
        const data = await response.json();
        if (!response.ok) {
            showToast(data.detail || "Failed to update role.", "error");
            return;
        }
        state.selectedAdminUser = data;
        await loadAdminUsers();
        showToast(`Role updated for ${data.username}.`, "success");
    });

    on("admin-password-form", "submit", async (event) => {
        event.preventDefault();
        if (!state.selectedAdminUser) return;
        const response = await apiFetch(`${API_ROOT}/admin/users/${state.selectedAdminUser.username}/password`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ new_password: document.getElementById("admin-reset-password").value }),
        });
        const data = await response.json();
        if (!response.ok) {
            showToast(data.detail || "Failed to reset password.", "error");
            return;
        }
        event.target.reset();
        showToast(`Password reset for ${state.selectedAdminUser.username}.`, "success");
    });

    on("admin-delete-user-button", "click", async () => {
        if (!state.selectedAdminUser) return;
        const username = state.selectedAdminUser.username;
        const confirmed = window.confirm(
            `Delete @${username}?\n\nThis will revoke access immediately and archive the account. Operation history will be preserved.`
        );
        if (!confirmed) return;
        setOperationBusy(`Deleting ${username}...`, "admin-delete-user-button");
        try {
            const response = await apiFetch(`${API_ROOT}/admin/users/${username}`, { method: "DELETE" });
            const data = await response.json();
            if (!response.ok) {
                showToast(data.detail || "Failed to delete user.", "error");
                return;
            }
            state.selectedAdminUser = null;
            await loadAdminUsers();
            renderAdminUserInspector();
            showToast(`User ${data.username} deleted.`, "success");
        } finally {
            setOperationBusy();
        }
    });

    on("admin-block-form", "submit", async (event) => {
        event.preventDefault();
        if (!state.selectedAdminBlock) return;
        const response = await apiFetch(`${API_ROOT}/admin/layout/${state.selectedAdminBlock.block}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                label: value("admin-block-name"),
                bay_count: numberValue("admin-block-bays"),
                row_count: numberValue("admin-block-rows"),
                tier_count: numberValue("admin-block-tiers"),
                equipment: value("admin-block-equipment") || null,
            }),
        });
        const data = await response.json();
        if (!response.ok) {
            showToast(data.detail || "Failed to update block layout.", "error");
            return;
        }
        state.layoutConfig = state.layoutConfig.map((item) => (item.block === data.block ? data : item));
        state.selectedAdminBlock = data;
        renderAdminBlocks();
        renderDashboard();
        showToast(`Block ${data.block} updated.`, "success");
    });

    on("admin-slot-form", "submit", async (event) => {
        event.preventDefault();
        if (!state.selectedAdminSlot) return;
        const allowedTypes = ["20ft", "40ft", "45ft"].filter((type) => checked(`slot-type-${type}`));
        const response = await apiFetch(`${API_ROOT}/admin/slots/${state.selectedAdminSlot.block}/${state.selectedAdminSlot.bay}/${state.selectedAdminSlot.row_num}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                enabled: !checked("admin-slot-blocked"),
                max_tiers: numberValue("admin-slot-tiers"),
                allowed_container_types: allowedTypes,
                notes: value("admin-slot-notes") || null,
            }),
        });
        const data = await response.json();
        if (!response.ok) {
            showToast(data.detail || "Failed to update slot.", "error");
            return;
        }
        state.slotCatalog = state.slotCatalog.map((slot) => (slot.slot_code === data.slot_code ? data : slot));
        state.selectedAdminSlot = data;
        renderAdminSlots();
        renderDashboard();
        showToast(`Slot ${data.slot_code} updated.`, "success");
    });
}

function setupReports() {
    initializeReportFilters();
    on("reports-filter-form", "submit", async (event) => {
        event.preventDefault();
        await loadOperationsReport();
    });
    on("reports-refresh", "click", async () => {
        await loadOperationsReport();
    });
    on("download-report-csv", "click", async () => {
        await downloadOperationsReport("csv");
    });
    on("download-report-pdf", "click", async () => {
        await downloadOperationsReport("pdf");
    });
    ["report-date-from", "report-date-to", "report-operation-type", "report-operator-query", "report-container-query"].forEach((id) => {
        on(id, "change", syncReportFiltersFromForm);
        on(id, "input", syncReportFiltersFromForm);
    });
    renderOperationsReport();
}

function restoreLocalSession() {
    const token = localStorage.getItem(STORAGE_TOKEN_KEY);
    const user = localStorage.getItem(STORAGE_USER_KEY);
    if (!token) {
        state.authToken = null;
        state.currentUser = null;
        localStorage.removeItem(STORAGE_USER_KEY);
        syncSessionBadge();
        return;
    }
    state.authToken = token;
    if (user) {
        try {
            state.currentUser = JSON.parse(user);
        } catch {
            state.currentUser = null;
        }
    }
    syncSessionBadge();
}

async function restoreSession() {
    try {
        const response = await fetch(`${API_ROOT}/users/me`, { headers: apiHeaders() });
        if (!response.ok) {
            resetSessionState();
            return false;
        }
        state.currentUser = await response.json();
        persistUser();
        syncSessionBadge();
        syncRoleBasedUi();
        hideAuthScreen();
        startAutoRefresh();
        renderDashboard();
        void loadInventory();
        return true;
    } catch {
        resetSessionState();
        return false;
    }
}

async function login(username, password) {
    setAuthError();
    setAuthBusy(true);
    try {
        const response = await fetch(`${API_ROOT}/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || "Login failed.");
        state.authToken = data.access_token;
        state.currentUser = data.user;
        state.containerHistory.clear();
        state.routingPreviewCache.clear();
        state.selectedAdminUser = null;
        state.selectedAdminBlock = null;
        state.selectedAdminSlot = null;
        localStorage.setItem(STORAGE_TOKEN_KEY, state.authToken);
        persistUser();
        syncSessionBadge();
        syncRoleBasedUi();
        hideAuthScreen();
        closeSettingsModal();
        startAutoRefresh();
        renderDashboard();
        void loadInventory();
        showToast(`Signed in as ${state.currentUser.full_name}.`, "success");
    } catch (error) {
        setAuthError(error.message);
    } finally {
        setAuthBusy(false);
    }
}

async function logout() {
    const authToken = state.authToken;
    resetSessionState();
    showAuthScreen();
    showToast("Signed out.", "success");
    if (!authToken) return;
    fetch(`${API_ROOT}/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
    }).catch(() => {});
}

function apiHeaders(extra = {}) {
    const headers = new Headers(extra);
    if (state.authToken) headers.set("Authorization", `Bearer ${state.authToken}`);
    return headers;
}

async function apiFetch(url, options = {}, allowUnauthorized = false) {
    const response = await fetch(url, { ...options, headers: apiHeaders(options.headers || {}) });
    if (response.status === 401 && !allowUnauthorized) {
        resetSessionState();
        showAuthScreen("Session expired. Sign in again.");
        throw new Error("Authentication required.");
    }
    return response;
}

function persistUser() {
    if (!state.currentUser) {
        localStorage.removeItem(STORAGE_USER_KEY);
        return;
    }
    localStorage.setItem(STORAGE_USER_KEY, JSON.stringify(state.currentUser));
}

function setAuthError(message = "") {
    const authError = document.getElementById("auth-error");
    authError.textContent = message;
    authError.classList.toggle("hidden", !message);
}

function resetSessionState() {
    state.authToken = null;
    state.currentUser = null;
    state.layoutConfig = [];
    state.terminalLayout = [];
    state.slotCatalog = [];
    state.slotRecordsByBlock = new Map();
    state.slotRecordIndex = new Map();
    state.inventory = [];
    state.containerById = new Map();
    state.blockContainersIndex = new Map();
    state.slotContainersIndex = new Map();
    state.surfaceOccupancyByBlock = new Map();
    state.logs = [];
    state.inventorySearchQuery = "";
    state.reports = {
        filters: {
            dateFrom: "",
            dateTo: "",
            operationType: "",
            operatorQuery: "",
            containerQuery: "",
        },
        items: [],
        summary: null,
        loaded: false,
        loading: false,
    };
    state.adminUsers = [];
    state.selectedAdminUser = null;
    state.selectedAdminBlock = null;
    state.selectedAdminSlot = null;
    state.selectedBlock = "01";
    state.selectedSlotKey = null;
    state.selectedContainerId = null;
    state.rowPage = 0;
    state.bayPage = 0;
    state.lastLoadedAt = null;
    state.moveDraftContainerId = null;
    state.draggingContainerId = null;
    state.dragOverSlotKey = null;
    state.pendingMove = null;
    state.inventoryLoadPromise = null;
    state.inventoryReloadQueued = false;
    state.inventoryLoadingVisible = false;
    state.authBusy = false;
    state.operationBusyLabel = "";
    state.busyButtonId = null;
    state.quickMoveContainerId = null;
    resetMoveTargetDraft();
    state.stackInPositionDirty = false;
    state.containerHistory.clear();
    state.routingPreviewCache.clear();
    state.formDirty.stackin = false;
    state.formDirty.stackout = false;
    state.formDirty.restow = false;
    localStorage.removeItem(STORAGE_TOKEN_KEY);
    localStorage.removeItem(STORAGE_USER_KEY);
    stopAutoRefresh();
    closeSettingsModal();
    document.getElementById("move-confirm-modal").classList.add("hidden");
    setValue("inventory-search", "");
    syncSessionBadge();
    syncRoleBasedUi();
    initializeReportFilters();
    renderOperationsReport();
    renderStackInBlockOptions();
    renderDashboard();
    renderBusyState();
}

function showAuthScreen(message = "") {
    document.getElementById("auth-screen").classList.add("active");
    document.getElementById("app-shell").classList.add("app-shell-hidden");
    setAuthError(message);
}

function hideAuthScreen() {
    setAuthError();
    document.getElementById("auth-screen").classList.remove("active");
    document.getElementById("app-shell").classList.remove("app-shell-hidden");
}

function openSettingsModal() {
    if (!state.currentUser) return;
    document.getElementById("settings-notifications-enabled").checked = Boolean(state.currentUser.notifications_enabled);
    document.getElementById("settings-telegram-enabled").checked = Boolean(state.currentUser.telegram_notifications_enabled);
    document.getElementById("settings-receive-all").checked = Boolean(state.currentUser.receive_all_movement_alerts);
    renderNotificationPreview();
    loadNotificationDeliveryFeed();
    document.getElementById("settings-modal").classList.remove("hidden");
}

function closeSettingsModal() {
    document.getElementById("settings-modal").classList.add("hidden");
}

function renderNotificationPreview() {
    const preview = document.getElementById("recipient-preview");
    if (!state.currentUser) {
        preview.innerHTML = `<div class="history-empty">Sign in to inspect recipients.</div>`;
        return;
    }
    const recipients = [];
    if (state.currentUser.notifications_enabled && state.currentUser.telegram_notifications_enabled) recipients.push(`${state.currentUser.full_name} (self, Telegram)`);
    if (state.currentUser.receive_all_movement_alerts || state.currentUser.role === "MANAGER") recipients.push("Shift manager coverage");
    if (state.currentUser.receive_all_movement_alerts || state.currentUser.role === "PLANNER") recipients.push("Yard planning supervision");
    recipients.push("Assigned expeditor when container has one");
    recipients.push("Shift control room for stack out and critical events");
    preview.innerHTML = recipients.map((item) => `<div class="history-item"><strong>${item}</strong><small>Notification routing preview for the current account.</small></div>`).join("");
}

async function loadNotificationDeliveryFeed() {
    const feed = document.getElementById("notification-delivery-feed");
    if (!state.authToken) {
        feed.innerHTML = `<div class="history-empty">Sign in to inspect delivery attempts.</div>`;
        return;
    }
    try {
        const response = await apiFetch(`${API_ROOT}/notifications/logs?limit=10`);
        if (!response.ok) {
            if (response.status === 403) {
                feed.innerHTML = `<div class="history-empty">This role cannot inspect global delivery attempts.</div>`;
                return;
            }
            throw new Error("Failed to load notification attempts.");
        }
        const logs = await response.json();
        if (!logs.length) {
            feed.innerHTML = `<div class="history-empty">No delivery attempts yet. The first movement event will appear here.</div>`;
            return;
        }
        feed.innerHTML = logs.map((entry) => `<div class="history-item"><strong>${entry.operation_type} · ${entry.container_id}</strong><span>${entry.success ? "Delivered to n8n" : "Waiting for n8n / delivery failed"}</span><small>${entry.targets.length} target(s) · HTTP ${entry.status_code || 0}</small></div>`).join("");
    } catch (error) {
        feed.innerHTML = `<div class="history-empty">${error.message}</div>`;
    }
}

function syncSessionBadge() {
    const nameEl = document.getElementById("session-user-name");
    const roleEl = document.getElementById("session-user-role");
    if (!state.currentUser) {
        nameEl.textContent = "Not signed in";
        roleEl.textContent = "offline";
        return;
    }
    nameEl.textContent = state.currentUser.full_name;
    roleEl.textContent = `${state.currentUser.role} · @${state.currentUser.username}`;
}

function syncRoleBasedUi() {
    const adminNavItem = document.getElementById("admin-nav-item");
    const reportsNavItem = document.getElementById("reports-nav-item");
    const canOpenAdmin = Boolean(state.currentUser && state.currentUser.role === "ADMIN");
    const canOpenReports = Boolean(state.currentUser?.permissions?.includes("view_audit"));
    adminNavItem.classList.toggle("hidden", !canOpenAdmin);
    reportsNavItem.classList.toggle("hidden", !canOpenReports);
    if (!canOpenReports && document.getElementById("reports-tab").classList.contains("active")) {
        openTab("dashboard-tab");
    }
    if (!canOpenAdmin && document.getElementById("admin-tab").classList.contains("active")) {
        openTab("dashboard-tab");
    }
}

function initializeReportFilters() {
    const today = getDateInputValue();
    const sevenDaysAgo = getDateInputValue(shiftLocalDate(new Date(), -6));
    state.reports.filters = {
        dateFrom: sevenDaysAgo,
        dateTo: today,
        operationType: "",
        operatorQuery: "",
        containerQuery: "",
    };
    applyReportFiltersToForm();
}

function applyReportFiltersToForm() {
    setValue("report-date-from", state.reports.filters.dateFrom || "");
    setValue("report-date-to", state.reports.filters.dateTo || "");
    setValue("report-operation-type", state.reports.filters.operationType || "");
    setValue("report-operator-query", state.reports.filters.operatorQuery || "");
    setValue("report-container-query", state.reports.filters.containerQuery || "");
}

function syncReportFiltersFromForm() {
    state.reports.filters = {
        dateFrom: value("report-date-from"),
        dateTo: value("report-date-to"),
        operationType: selectValue("report-operation-type"),
        operatorQuery: optionalValue("report-operator-query") || "",
        containerQuery: optionalValue("report-container-query") || "",
    };
}

function getDateInputValue(source = new Date()) {
    const year = source.getFullYear();
    const month = String(source.getMonth() + 1).padStart(2, "0");
    const day = String(source.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function shiftLocalDate(source, days) {
    const next = new Date(source.getFullYear(), source.getMonth(), source.getDate());
    next.setDate(next.getDate() + days);
    return next;
}

function buildOperationsReportQuery(format = null) {
    syncReportFiltersFromForm();
    const params = new URLSearchParams();
    params.set("date_from", state.reports.filters.dateFrom);
    params.set("date_to", state.reports.filters.dateTo);
    params.set("utc_offset_minutes", String(-new Date().getTimezoneOffset()));
    if (state.reports.filters.operationType) params.set("operation_type", state.reports.filters.operationType);
    if (state.reports.filters.operatorQuery) params.set("operator_query", state.reports.filters.operatorQuery);
    if (state.reports.filters.containerQuery) params.set("container_query", state.reports.filters.containerQuery);
    if (format) params.set("format", format);
    return params;
}

async function loadOperationsReport() {
    syncReportFiltersFromForm();
    if (!state.reports.filters.dateFrom || !state.reports.filters.dateTo) {
        showToast("Choose both Date From and Date To.", "error");
        return;
    }
    state.reports.loading = true;
    renderOperationsReport();
    setOperationBusy("Loading operations report...", "reports-refresh");
    try {
        const response = await apiFetch(`${API_ROOT}/reports/operations?${buildOperationsReportQuery().toString()}`);
        const data = await response.json();
        if (!response.ok) {
            showToast(data.detail || "Failed to load operations report.", "error");
            return;
        }
        state.reports.items = Array.isArray(data.items) ? data.items : [];
        state.reports.summary = data.summary || null;
        state.reports.filters = {
            dateFrom: data.filters?.date_from || state.reports.filters.dateFrom,
            dateTo: data.filters?.date_to || state.reports.filters.dateTo,
            operationType: data.filters?.operation_type || "",
            operatorQuery: data.filters?.operator_query || "",
            containerQuery: data.filters?.container_query || "",
        };
        state.reports.loaded = true;
        applyReportFiltersToForm();
        renderOperationsReport();
        showToast(`Loaded ${state.reports.summary?.total_records || 0} movement record(s).`, "success");
    } finally {
        state.reports.loading = false;
        renderOperationsReport();
        setOperationBusy("", "reports-refresh");
    }
}

async function downloadOperationsReport(format) {
    syncReportFiltersFromForm();
    if (!state.reports.filters.dateFrom || !state.reports.filters.dateTo) {
        showToast("Choose both Date From and Date To before exporting.", "error");
        return;
    }
    const buttonId = format === "pdf" ? "download-report-pdf" : "download-report-csv";
    const label = format === "pdf" ? "Building PDF report..." : "Preparing CSV export...";
    setOperationBusy(label, buttonId);
    try {
        const response = await apiFetch(`${API_ROOT}/reports/operations/export?${buildOperationsReportQuery(format).toString()}`);
        if (!response.ok) {
            let message = `Failed to export ${format.toUpperCase()} report.`;
            try {
                const payload = await response.json();
                message = payload.detail || message;
            } catch {
                const text = await response.text();
                if (text) message = text;
            }
            showToast(message, "error");
            return;
        }
        const blob = await response.blob();
        const disposition = response.headers.get("Content-Disposition") || "";
        const filenameMatch = disposition.match(/filename=\"([^\"]+)\"/);
        const filename = filenameMatch?.[1] || `operations-report.${format}`;
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 5000);
        showToast(`${format.toUpperCase()} report downloaded.`, "success");
    } finally {
        setOperationBusy("", buttonId);
    }
}

function renderOperationsReport() {
    const feedback = document.getElementById("reports-feedback");
    const subtitle = document.getElementById("reports-preview-subtitle");
    const tbody = document.getElementById("reports-preview-body");
    const csvButton = document.getElementById("download-report-csv");
    const pdfButton = document.getElementById("download-report-pdf");
    const refreshButton = document.getElementById("reports-refresh");
    if (!feedback || !subtitle || !tbody || !csvButton || !pdfButton || !refreshButton) return;

    const summary = state.reports.summary || {
        total_records: 0,
        unique_containers: 0,
        stack_in: 0,
        stack_out: 0,
        restow: 0,
        unique_users: 0,
        operators: [],
    };
    const hasItems = state.reports.items.length > 0;
    const hasLoadedEmpty = state.reports.loaded && !hasItems;

    refreshButton.disabled = state.reports.loading;
    csvButton.disabled = state.reports.loading || !state.reports.loaded;
    pdfButton.disabled = state.reports.loading || !state.reports.loaded;

    if (state.reports.loading) {
        feedback.textContent = "Loading filtered operations from the yard log...";
        feedback.className = "form-feedback neutral";
    } else if (!state.reports.loaded) {
        feedback.textContent = "Choose a period and load the preview. CSV is best for raw data, PDF is best for a polished shareable report.";
        feedback.className = "form-feedback neutral";
    } else if (hasLoadedEmpty) {
        feedback.textContent = "No movements matched the selected filters.";
        feedback.className = "form-feedback warning";
    } else {
        feedback.textContent = `Ready to export ${summary.total_records} movement record(s) for ${state.reports.filters.dateFrom} to ${state.reports.filters.dateTo}.`;
        feedback.className = "form-feedback neutral";
    }

    subtitle.textContent = state.reports.loaded
        ? `${summary.total_records} record(s) matched. Preview uses the same filters as the download files.`
        : "Latest filtered movements will appear here before export.";

    setText("report-total-records", String(summary.total_records || 0));
    setText("report-total-containers", String(summary.unique_containers || 0));
    setText("report-stack-in-count", String(summary.stack_in || 0));
    setText("report-stack-out-count", String(summary.stack_out || 0));
    setText("report-restow-count", String(summary.restow || 0));
    setText("report-total-users", String(summary.unique_users || 0));

    renderReportOperators(summary.operators || []);

    if (!state.reports.loaded) {
        tbody.innerHTML = `<tr><td colspan="7" class="report-empty-cell">Load a report to preview the full movement history.</td></tr>`;
        return;
    }

    if (!hasItems) {
        tbody.innerHTML = `<tr><td colspan="7" class="report-empty-cell">No movements found for the selected date range.</td></tr>`;
        return;
    }

    tbody.innerHTML = state.reports.items.map((entry) => {
        const snapshot = entry.container_snapshot || {};
        const cargoBits = [
            snapshot.status,
            snapshot.direction,
            snapshot.line,
            snapshot.commodity,
            snapshot.weight != null ? `${Number(snapshot.weight).toLocaleString("en-GB")} kg` : "",
        ].filter(Boolean);
        const operator = [entry.operator_full_name || entry.operator_username || "System", entry.operator_role].filter(Boolean).join(" · ");
        const override = entry.emergency_override ? `Yes${entry.override_reason ? ` · ${escapeHtml(entry.override_reason)}` : ""}` : "No";
        return `
            <tr>
                <td>${escapeHtml(formatDateTime(entry.performed_at_local || entry.performed_at))}</td>
                <td><strong>${escapeHtml(humanizeOperation(entry.operation_type))}</strong></td>
                <td><strong>${escapeHtml(entry.container_id)}</strong><br><small>${escapeHtml(snapshot.container_type || "-")}</small></td>
                <td>${escapeHtml(formatOperationRoute(entry))}</td>
                <td>${escapeHtml(cargoBits.join(" · ") || "-")}</td>
                <td>${escapeHtml(operator)}</td>
                <td>${override}</td>
            </tr>
        `;
    }).join("");
}

function renderReportOperators(operators) {
    const list = document.getElementById("report-operator-list");
    if (!list) return;
    if (!operators.length) {
        list.innerHTML = `<div class="history-empty">No operators matched this period yet.</div>`;
        return;
    }
    list.innerHTML = operators.slice(0, 12).map((operator) => {
        const label = operator.full_name || operator.username || "System";
        const meta = [operator.username ? `@${operator.username}` : null, operator.role].filter(Boolean).join(" · ");
        return `<div class="history-item"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(meta || "No role recorded")}</span><small>${operator.operations} operation(s)</small></div>`;
    }).join("");
}

function formatOperationRoute(entry) {
    if (entry.old_position_code) return `${entry.old_position_code} -> ${entry.new_position_code || "OUT"}`;
    return entry.new_position_code || "IN";
}

function canUseEmergencyDepartureOverride() {
    return Boolean(state.currentUser?.permissions?.includes("emergency_departure_override"));
}

function getOverrideElements(prefix) {
    return {
        panel: document.getElementById(`${prefix}-override-panel`),
        checkbox: document.getElementById(`${prefix}-emergency-override`),
        reason: document.getElementById(`${prefix}-override-reason`),
        feedback: document.getElementById(`${prefix}-override-feedback`),
    };
}

function setOverrideFeedback(node, tone, message) {
    if (!node) return;
    node.textContent = message;
    node.classList.remove("neutral", "warning", "error");
    node.classList.add(tone);
}

function hideOverridePanel(prefix) {
    const { panel, checkbox, reason, feedback } = getOverrideElements(prefix);
    if (panel) panel.classList.add("hidden");
    if (checkbox) checkbox.checked = false;
    if (reason) {
        reason.value = "";
        reason.disabled = true;
    }
    if (feedback) setOverrideFeedback(feedback, "warning", "Emergency override requires a clear operational reason.");
}

function syncOverridePanel(prefix, config = {}) {
    const { panel, checkbox, reason, feedback } = getOverrideElements(prefix);
    if (!panel || !checkbox || !reason || !feedback) return;
    const { visible = false, conflictMessage = "", readyMessage = "" } = config;
    if (!visible) {
        hideOverridePanel(prefix);
        return;
    }
    panel.classList.remove("hidden");
    reason.disabled = !checkbox.checked;
    if (!checkbox.checked) {
        setOverrideFeedback(feedback, "warning", conflictMessage || "Emergency override is required for this blocked stacking order.");
        return;
    }
    if (!reason.value.trim()) {
        setOverrideFeedback(feedback, "warning", "Enter a short reason before confirming the emergency override.");
        return;
    }
    setOverrideFeedback(feedback, "warning", readyMessage || "Emergency override will be logged with your reason.");
}

function openMoveConfirmModal(moveTarget) {
    state.pendingMove = {
        ...moveTarget,
        emergencyOverride: Boolean(moveTarget.emergencyOverride),
        overrideReason: moveTarget.overrideReason || null,
    };
    moveTarget = state.pendingMove;
    setText("move-confirm-container", moveTarget.movingContainer.container_id);
    setText("move-confirm-type", `${moveTarget.movingContainer.container_type} · ${moveTarget.movingContainer.status} · ${moveTarget.movingContainer.direction}`);
    setText("move-confirm-route", `${moveTarget.movingContainer.position_code} -> ${moveTarget.target.block}-${moveTarget.target.bay}-${moveTarget.target.row}-${moveTarget.nextTier}`);
    setText("move-confirm-tier", `Target tier ${moveTarget.nextTier} of ${moveTarget.slotRecord.max_tiers}`);
    const conflictMarkup = moveTarget.departureRuleConflict
        ? `
        <div class="history-item move-rule-item">
            <strong>Stacking Order Block</strong>
            <span>${escapeHtml(moveTarget.departureRuleConflict.message)}</span>
            <small>This move is blocked unless an emergency override is confirmed and logged.</small>
        </div>
        `
        : "";
    document.getElementById("move-confirm-rules").innerHTML = `
        <div class="history-item move-rule-item">
            <strong>Allowed Types</strong>
            <span>${moveTarget.slotRecord.allowed_container_types.join(", ")}</span>
            <small>${moveTarget.slotRecord.notes || "No slot note"}</small>
        </div>
        <div class="history-item move-rule-item">
            <strong>Slot Status</strong>
            <span>${moveTarget.slotRecord.enabled ? "Open" : "Blocked"}</span>
            <small>${moveTarget.target.block}-${moveTarget.target.bay}-${moveTarget.target.row}</small>
        </div>
        ${conflictMarkup}
    `;
    renderMoveConfirmOverridePanel(moveTarget);
    document.getElementById("move-confirm-modal").classList.remove("hidden");
}

function closeMoveConfirmModal() {
    document.getElementById("move-confirm-modal").classList.add("hidden");
    hideOverridePanel("move-confirm");
    state.pendingMove = null;
    state.draggingContainerId = null;
    state.dragOverSlotKey = null;
    state.moveDraftContainerId = null;
    renderDashboard();
}

function renderMoveConfirmOverridePanel(moveTarget) {
    const confirmButton = document.getElementById("confirm-move-button");
    if (!moveTarget?.departureRuleConflict) {
        hideOverridePanel("move-confirm");
        if (confirmButton) confirmButton.textContent = "Confirm Restow";
        return;
    }
    const { checkbox, reason } = getOverrideElements("move-confirm");
    if (checkbox) checkbox.checked = Boolean(moveTarget.emergencyOverride);
    if (reason) {
        const overrideReason = moveTarget.overrideReason || "";
        if (reason.value !== overrideReason) reason.value = overrideReason;
    }
    syncOverridePanel("move-confirm", {
        visible: true,
        conflictMessage: `${moveTarget.departureRuleConflict.message} Enable emergency override to continue.`,
        readyMessage: `Emergency override will be logged against lower container ${moveTarget.departureRuleConflict.item.container_id}.`,
    });
    if (confirmButton) confirmButton.textContent = checked("move-confirm-emergency-override") ? "Confirm Override" : "Confirm Restow";
}

function startAutoRefresh() {
    stopAutoRefresh();
    state.autoRefreshTimer = window.setInterval(() => {
        if (!state.authToken || document.visibilityState === "hidden") return;
        if (state.draggingContainerId || state.moveDraftContainerId || state.pendingMove) return;
        if (!document.getElementById("app-shell").classList.contains("app-shell-hidden")) loadInventory({ silent: true });
    }, AUTO_REFRESH_MS);
}

function stopAutoRefresh() {
    if (state.autoRefreshTimer) window.clearInterval(state.autoRefreshTimer);
    state.autoRefreshTimer = null;
}

function normalizeLayoutRecords() {
    const base = (state.layoutConfig.length ? state.layoutConfig : DEFAULT_LAYOUT).map((layout) => ({
        block: layout.block,
        label: layout.label || `Block ${layout.block}`,
        bayCount: Number(layout.bay_count || layout.bayCount),
        rowCount: Number(layout.row_count || layout.rowCount),
        tierCount: Number(layout.tier_count || layout.tierCount),
        equipment: layout.equipment || null,
        footprint: layout.footprint || `${layout.bay_count || layout.bayCount} x ${layout.row_count || layout.rowCount}`,
    }));
    return base.map((layout) => ({
        ...layout,
        bays: Array.from({ length: layout.bayCount }, (_, index) => formatBayNumber(index * 2 + 1)),
        rows: Array.from({ length: layout.rowCount }, (_, index) => index + 1),
    }));
}

function rebuildDerivedState() {
    state.terminalLayout = normalizeLayoutRecords();

    const rawSlotsByBlock = new Map();
    state.slotCatalog.forEach((slot) => {
        const block = slot.block;
        const normalized = {
            ...slot,
            bay: formatBayNumber(slot.bay),
            row_num: Number(slot.row_num),
            max_tiers: Number(slot.max_tiers ?? 4),
        };
        if (!rawSlotsByBlock.has(block)) rawSlotsByBlock.set(block, []);
        rawSlotsByBlock.get(block).push(normalized);
    });

    state.slotRecordsByBlock = new Map();
    state.slotRecordIndex = new Map();
    state.containerById = new Map();
    state.terminalLayout.forEach((layout) => {
        const provided = rawSlotsByBlock.get(layout.block);
        const blockSlots = provided?.length
            ? provided
            : layout.rows.flatMap((row) => layout.bays.map((bay) => getFallbackSlotRecord(layout.block, bay, row)));
        state.slotRecordsByBlock.set(layout.block, blockSlots);
        blockSlots.forEach((slot) => {
            state.slotRecordIndex.set(getSlotKey(layout.block, slot.bay, Number(slot.row_num)), slot);
        });
    });

    state.blockContainersIndex = new Map();
    state.slotContainersIndex = new Map();
    state.surfaceOccupancyByBlock = new Map();

    state.inventory.forEach((container) => {
        const normalized = {
            ...container,
            bay: formatBayNumber(container.bay),
            row_num: Number(container.row_num),
            tier_num: Number(container.tier_num),
        };
        state.containerById.set(normalized.container_id, normalized);
        if (!state.blockContainersIndex.has(normalized.block)) state.blockContainersIndex.set(normalized.block, []);
        state.blockContainersIndex.get(normalized.block).push(normalized);

        if (!state.surfaceOccupancyByBlock.has(normalized.block)) state.surfaceOccupancyByBlock.set(normalized.block, new Set());
        getSurfaceBaysForPlacement(normalized.block, normalized.bay, normalized.container_type).forEach((surfaceBay) => {
            const slotKey = getSlotKey(normalized.block, surfaceBay, normalized.row_num);
            if (!state.slotContainersIndex.has(slotKey)) state.slotContainersIndex.set(slotKey, []);
            state.slotContainersIndex.get(slotKey).push(normalized);
            state.surfaceOccupancyByBlock.get(normalized.block).add(slotKey);
        });
    });

    state.blockContainersIndex.forEach((containers, block) => {
        containers.sort((a, b) => a.position_code.localeCompare(b.position_code));
        state.blockContainersIndex.set(block, containers);
    });
    state.slotContainersIndex.forEach((containers, key) => {
        containers.sort((a, b) => a.tier_num - b.tier_num);
        state.slotContainersIndex.set(key, containers);
    });
}

function isAdminTabActive() {
    return Boolean(document.getElementById("admin-tab")?.classList.contains("active"));
}

function getDashboardStatsFromPayload(payload = {}) {
    if (payload.stats) {
        return {
            todayIn: Number(payload.stats.today_in ?? 0),
            todayOut: Number(payload.stats.today_out ?? 0),
        };
    }
    const todayKey = getLocalDateKey();
    const logs = Array.isArray(payload.logs) ? payload.logs : [];
    return logs.reduce((stats, entry) => {
        if (getLocalDateKey(new Date(entry.performed_at)) !== todayKey) return stats;
        if (entry.operation_type === "STACK_IN") stats.todayIn += 1;
        if (entry.operation_type === "STACK_OUT") stats.todayOut += 1;
        return stats;
    }, { todayIn: 0, todayOut: 0 });
}

function applyInventoryPayload(payload = {}) {
    state.layoutConfig = Array.isArray(payload.layout) ? payload.layout : [];
    state.slotCatalog = Array.isArray(payload.slots) ? payload.slots : [];
    state.inventory = Array.isArray(payload.inventory)
        ? payload.inventory.map((item) => ({
            ...item,
            row_num: Number(item.row_num),
            tier_num: Number(item.tier_num),
            bonded: Boolean(item.bonded),
            weight: item.weight == null || item.weight === "" ? null : Number(item.weight),
        }))
        : [];
    state.logs = Array.isArray(payload.logs) ? payload.logs : [];
    state.dashboardStats = getDashboardStatsFromPayload(payload);
    rebuildDerivedState();
    state.lastLoadedAt = new Date();
    preserveSelection();

    if (Array.isArray(payload.admin_users)) {
        state.adminUsers = payload.admin_users;
        if (state.selectedAdminUser) {
            state.selectedAdminUser = state.adminUsers.find((user) => user.username === state.selectedAdminUser.username) || null;
        }
        if (isAdminTabActive()) renderAdminUsers();
    }

    if (state.currentUser?.permissions?.includes("manage_layout") && isAdminTabActive()) {
        renderAdminBlocks();
        renderAdminSlots();
    }
    renderStackInBlockOptions();
    renderDashboard();
}

async function loadInventoryLegacy() {
    const [layoutResponse, slotsResponse, inventoryResponse, logsResponse] = await Promise.all([
        apiFetch(`${API_ROOT}/yard/layout`),
        apiFetch(`${API_ROOT}/yard/slots`),
        apiFetch(`${API_BASE_URL}/inventory`),
        apiFetch(`${API_BASE_URL}/logs?limit=200`),
    ]);
    if (!inventoryResponse.ok) throw new Error("Failed to fetch inventory.");
    return {
        layout: layoutResponse.ok ? await layoutResponse.json() : [],
        slots: slotsResponse.ok ? await slotsResponse.json() : [],
        inventory: await inventoryResponse.json(),
        logs: logsResponse.ok ? await logsResponse.json() : [],
    };
}

function buildPositionCode(block, bay, row, tier) {
    return `${block}-${String(bay).padStart(2, "0")}-${row}-${tier}`;
}

function applyOptimisticRestow(containerId, destination) {
    const container = findContainerById(containerId);
    if (!container) return false;
    container.block = destination.block;
    container.bay = String(destination.bay).padStart(2, "0");
    container.row_num = Number(destination.row);
    container.tier_num = Number(destination.tier);
    container.position_code = buildPositionCode(container.block, container.bay, container.row_num, container.tier_num);
    container.positioned_at = new Date().toISOString();
    container.updated_at = container.positioned_at;
    return true;
}

function refreshInventoryInBackground() {
    void loadInventory({ silent: true });
}

async function loadInventory(options = {}) {
    if (!state.authToken) return;
    if (state.inventoryLoadPromise) {
        state.inventoryReloadQueued = true;
        state.inventoryLoadingVisible = state.inventoryLoadingVisible || !options.silent || !state.lastLoadedAt;
        renderBusyState();
        return state.inventoryLoadPromise;
    }

    state.inventoryLoadingVisible = !options.silent || !state.lastLoadedAt;
    const task = (async () => {
        try {
            const params = new URLSearchParams({ logs_limit: "50" });
            params.set("dashboard_date", getLocalDateKey());
            params.set("utc_offset_minutes", String(-new Date().getTimezoneOffset()));
            const shouldIncludeAdminUsers = Boolean(
                state.currentUser?.permissions?.includes("manage_users")
                && document.getElementById("admin-tab")?.classList.contains("active")
            );
            if (shouldIncludeAdminUsers) params.set("include_admin_users", "true");
            const bootstrapResponse = await apiFetch(`${API_ROOT}/bootstrap?${params.toString()}`);
            if (!bootstrapResponse.ok) throw new Error("Failed to load terminal data.");
            applyInventoryPayload(await bootstrapResponse.json());
        } catch (error) {
            try {
                applyInventoryPayload(await loadInventoryLegacy());
            } catch (fallbackError) {
                if (!options.silent) {
                    showToast(fallbackError.message || error.message, "error");
                }
            }
        }
    })();

    state.inventoryLoadPromise = task;
    renderBusyState();
    try {
        await task;
    } finally {
        state.inventoryLoadPromise = null;
        state.inventoryLoadingVisible = false;
        renderBusyState();
        if (state.inventoryReloadQueued && state.authToken) {
            state.inventoryReloadQueued = false;
            void loadInventory({ silent: true });
        }
    }
}

async function submitForm(form, url, payload) {
    const button = form.querySelector("button[type='submit']");
    const label = form.id === "stackin-form" ? "Processing Stack In..." : form.id === "stackout-form" ? "Processing Stack Out..." : "Processing Restow...";
    setOperationBusy(label, button?.id || null);
    try {
        const response = await apiFetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        const data = await response.json();
        if (!response.ok) {
            showToast(data.detail || "Operation failed.", "error");
            return;
        }
        if (form.id === "stackin-form") state.formDirty.stackin = false;
        if (form.id === "stackin-form") state.stackInPositionDirty = false;
        if (form.id === "stackout-form") state.formDirty.stackout = false;
        if (form.id === "restow-form") state.formDirty.restow = false;
        if (typeof form.reset === "function") form.reset();
        if (form.id === "restow-form") {
            const previousBlock = state.selectedBlock;
            applyOptimisticRestow(payload.container_id, {
                block: payload.new_block,
                bay: payload.new_bay,
                row: payload.new_row,
                tier: payload.new_tier,
            });
            state.selectedContainerId = payload.container_id;
            state.selectedBlock = payload.new_block;
            state.selectedSlotKey = getSlotKey(payload.new_block, ["40ft", "45ft"].includes(findContainerById(payload.container_id)?.container_type) ? getSurfaceStartBayFromWideAnchor(String(payload.new_bay).padStart(2, "0")) : String(payload.new_bay).padStart(2, "0"), payload.new_row);
            ensureSlotVisible(payload.new_block, String(payload.new_bay).padStart(2, "0"), payload.new_row);
            ensureContainerHistory(payload.container_id);
            renderDashboard({
                stats: true,
                overview: true,
                inventory: false,
                activity: false,
                liveStatus: false,
            });
            refreshInventoryInBackground();
        } else {
            await loadInventory({ silent: true });
            if (payload.container_id) {
                const updatedContainer = findContainerById(payload.container_id);
                if (updatedContainer) {
                    state.selectedContainerId = updatedContainer.container_id;
                    state.selectedBlock = updatedContainer.block;
                    state.selectedSlotKey = getSlotKey(updatedContainer.block, getSurfaceStartBay(updatedContainer), updatedContainer.row_num);
                    ensureContainerHistory(updatedContainer.container_id);
                } else {
                    state.selectedContainerId = null;
                    state.selectedSlotKey = null;
                }
            }
            renderDashboard();
        }
        showToast(data.message || "Operation completed.", "success");
    } finally {
        setOperationBusy("", button?.id || null);
    }
}

function preserveSelection() {
    const layouts = getTerminalLayout();
    const availableBlocks = layouts.map((layout) => layout.block);
    if (!availableBlocks.includes(state.selectedBlock)) state.selectedBlock = availableBlocks[0] || "01";
    if (state.selectedContainerId && !findContainerById(state.selectedContainerId)) state.selectedContainerId = null;
    if (state.selectedSlotKey) {
        const parsed = parseSlotKey(state.selectedSlotKey);
        if (!parsed || !availableBlocks.includes(parsed.block)) {
            state.selectedSlotKey = null;
        } else {
            ensureSlotVisible(parsed.block, parsed.bay, parsed.row);
        }
    }
}

function getTerminalLayout() {
    return state.terminalLayout.length ? state.terminalLayout : normalizeLayoutRecords();
}

function getBlockLayout(block) {
    const layouts = getTerminalLayout();
    return layouts.find((item) => item.block === block) || layouts[0];
}

function formatBayNumber(value) {
    return String(Number(value)).padStart(2, "0");
}

function parseBayNumber(value) {
    return Number(String(value));
}

function isSurfaceBay(value) {
    return parseBayNumber(value) % 2 === 1;
}

function getMaxSurfaceBay(block) {
    return getBlockLayout(block).bayCount * 2 - 1;
}

function getMaxWideBay(block) {
    return getMaxSurfaceBay(block) - 1;
}

function canStartWideAtSurfaceBay(block, bay) {
    const bayNum = parseBayNumber(bay);
    return bayNum % 4 === 1 && bayNum + 2 <= getMaxSurfaceBay(block);
}

function getWideAnchorBayFromSurfaceBay(bay) {
    return formatBayNumber(parseBayNumber(bay) + 1);
}

function getWideSurfaceBaysFromAnchor(bay) {
    const anchorNum = parseBayNumber(bay);
    return [formatBayNumber(anchorNum - 1), formatBayNumber(anchorNum + 1)];
}

function getSurfaceStartBayFromWideAnchor(bay) {
    return getWideSurfaceBaysFromAnchor(bay)[0];
}

function getSurfaceStartBay(container) {
    return isWideContainer(container) ? getWideSurfaceBaysFromAnchor(container.bay)[0] : formatBayNumber(container.bay);
}

function is45ftAnchorAllowed(block, bay) {
    const bayNum = parseBayNumber(bay);
    return bayNum === 2 || bayNum === getMaxWideBay(block);
}

function defaultAllowedTypesForBay(block, bay) {
    const allowed = ["20ft"];
    if (canStartWideAtSurfaceBay(block, bay)) {
        allowed.push("40ft");
        if (is45ftAnchorAllowed(block, getWideAnchorBayFromSurfaceBay(bay))) {
            allowed.push("45ft");
        }
    }
    return allowed;
}

function isWideContainer(container) {
    return Boolean(container && ["40ft", "45ft"].includes(container.container_type));
}

function canContainerSpanHorizontal(container) {
    return isWideContainer(container);
}

function getCoveredSurfaceSlotKey(container) {
    if (!canContainerSpanHorizontal(container)) return null;
    return getSlotKey(container.block, getWideSurfaceBaysFromAnchor(container.bay)[1], container.row_num);
}

function getSurfaceBaysForPlacement(block, bay, containerType) {
    if (!["40ft", "45ft"].includes(containerType)) return [formatBayNumber(bay)];
    return getWideSurfaceBaysFromAnchor(bay);
}

function getActualBayForPlacement(containerType, block, surfaceBay) {
    if (!["40ft", "45ft"].includes(containerType)) return formatBayNumber(surfaceBay);
    if (!canStartWideAtSurfaceBay(block, surfaceBay)) return null;
    const anchorBay = getWideAnchorBayFromSurfaceBay(surfaceBay);
    if (containerType === "45ft" && !is45ftAnchorAllowed(block, anchorBay)) return null;
    return anchorBay;
}

function getSurfaceOccupancy(block) {
    return state.surfaceOccupancyByBlock.get(block) || new Set();
}

function getAnchoredWideContainer(block, bay, row) {
    if (!canStartWideAtSurfaceBay(block, bay)) return null;
    const anchorContainer = getVisibleContainerForSlot(getSlotContainers(block, bay, row));
    return canContainerSpanHorizontal(anchorContainer) && getSurfaceStartBay(anchorContainer) === formatBayNumber(bay) ? anchorContainer : null;
}

function getCoveringWideContainer(block, bay, row) {
    const bayNum = parseBayNumber(bay);
    if (bayNum % 4 !== 3) return null;
    const coveringContainer = getVisibleContainerForSlot(getSlotContainers(block, bay, row));
    return canContainerSpanHorizontal(coveringContainer) && getSurfaceStartBay(coveringContainer) !== formatBayNumber(bay) ? coveringContainer : null;
}

function getCoveredWideSupportContainer(block, bay, row) {
    if (state.tierVisibility !== "top") return null;
    const bayNum = parseBayNumber(bay);
    if (bayNum % 4 !== 3) return null;
    const slotVisibleContainer = getVisibleContainerForSlot(getSlotContainers(block, bay, row));
    if (slotVisibleContainer && !canContainerSpanHorizontal(slotVisibleContainer)) return null;
    const anchorBay = formatBayNumber(bayNum - 2);
    const anchorSlotContainers = getSlotContainers(block, anchorBay, row);
    const anchorVisibleContainer = getVisibleContainerForSlot(anchorSlotContainers);
    if (!anchorVisibleContainer || canContainerSpanHorizontal(anchorVisibleContainer)) return null;
    for (let index = anchorSlotContainers.length - 1; index >= 0; index -= 1) {
        const candidate = anchorSlotContainers[index];
        if (Number(candidate.tier_num) >= Number(anchorVisibleContainer.tier_num)) continue;
        if (canContainerSpanHorizontal(candidate) && getCoveredSurfaceSlotKey(candidate) === getSlotKey(block, bay, row)) {
            return candidate;
        }
    }
    return null;
}

function getSurfacePositionCodes(block, bay, row, tier, containerType) {
    return getSurfaceBaysForPlacement(block, bay, containerType).map((surfaceBay) => `${block}-${surfaceBay}-${row}-${tier}`);
}

function getSurfaceSlotKeys(block, bay, row, containerType) {
    return getSurfaceBaysForPlacement(block, bay, containerType).map((surfaceBay) => `${block}-${surfaceBay}-${row}`);
}

function findPositionOccupant(block, bay, row, tier, containerType, excludeContainerId = null) {
    const surfaceBays = getSurfaceBaysForPlacement(block, bay, containerType);
    for (const surfaceBay of surfaceBays) {
        const slotContainers = getSlotContainers(block, surfaceBay, row);
        const occupant = slotContainers.find((container) => {
            if (excludeContainerId && container.container_id === excludeContainerId) return false;
            return Number(container.tier_num) === Number(tier);
        });
        if (occupant) return occupant;
    }
    return null;
}

function hasSupportingBase(block, bay, row, tier, containerType) {
    if (tier <= 1) return true;
    const supportSurfaceBays = getSurfaceBaysForPlacement(block, bay, containerType);
    return supportSurfaceBays.every((surfaceBay) =>
        getSlotContainers(block, surfaceBay, row).some((container) => Number(container.tier_num) === Number(tier) - 1)
    );
}

function getFallbackSlotRecord(block, bay, row) {
    return {
        block,
        bay,
        row_num: row,
        slot_code: `${block}-${bay}-${row}`,
        enabled: true,
        max_tiers: getBlockLayout(block).tierCount,
        allowed_container_types: defaultAllowedTypesForBay(block, bay),
        notes: null,
    };
}

function getBlockSlotRecords(block) {
    return state.slotRecordsByBlock.get(block) || [];
}

function getSlotRecord(block, bay, row) {
    return state.slotRecordIndex.get(getSlotKey(block, bay, row)) || getFallbackSlotRecord(block, bay, row);
}

function renderDashboard(options = {}) {
    const {
        clamp = true,
        stats = true,
        overview = true,
        bayGrid = true,
        inventory = true,
        inspector = true,
        activity = true,
        liveStatus = true,
    } = options;

    if (clamp) clampViewport();
    if (stats) renderStats();
    if (overview) renderOverview();
    if (bayGrid) renderBayGrid();
    if (inventory) renderInventoryTable();
    if (inspector) renderInspector();
    if (activity) renderActivityFeed();
    if (liveStatus) updateLiveStatus();
    renderStackInAdvisory();
    renderRestowAdvisory();
}

function refreshBayGridSelectionState() {
    const bayGrid = document.getElementById("bay-grid");
    if (!bayGrid) return;
    bayGrid.querySelectorAll(".slot-cell").forEach((cell) => {
        const slotKeys = getCellSlotKeys(cell);
        cell.classList.toggle("is-selected", slotKeys.includes(state.selectedSlotKey));
        cell.classList.toggle("is-target", Boolean(state.moveDraftContainerId && slotKeys.includes(state.selectedSlotKey)));
        cell.classList.toggle("is-drop-target", slotKeys.includes(state.dragOverSlotKey));
    });
}

function renderSelectionState(blockChanged = false) {
    if (blockChanged) {
        renderDashboard({ inventory: false, activity: false });
        return;
    }
    refreshBayGridSelectionState();
    renderInspector();
}

function renderStats() {
    const totalContainers = state.inventory.length;
    const todayIn = state.dashboardStats.todayIn;
    const todayOut = state.dashboardStats.todayOut;
    const slots = getBlockSlotRecords(state.selectedBlock).filter((slot) => slot.enabled);
    const occupiedSlots = getSurfaceOccupancy(state.selectedBlock).size;
    setText("total-containers", String(totalContainers));
    setText("today-in", String(todayIn));
    setText("today-out", String(todayOut));
    setText("selected-block-load", `${occupiedSlots} / ${slots.length}`);
}

function renderOverview() {
    const overview = document.getElementById("terminal-overview");
    overview.innerHTML = getTerminalLayout().map((layout) => {
        const blockContainers = getBlockContainers(layout.block);
        const blockSlots = getBlockSlotRecords(layout.block).filter((slot) => slot.enabled);
        const occupied = getSurfaceOccupancy(layout.block).size;
        const total = blockSlots.length || (layout.bays.length * layout.rows.length);
        const percent = total === 0 ? 0 : Math.round((occupied / total) * 100);
        const overviewGrid = getOverviewGridConfig(layout);
        return `
            <button type="button" class="terminal-block ${layout.block === state.selectedBlock ? "active" : ""}" data-block="${layout.block}" aria-label="Open ${layout.label}">
                <div class="terminal-block-top">
                    <div class="terminal-block-meta">
                        <span class="terminal-block-kicker">Block ${layout.block}</span>
                        <strong>${layout.label}</strong>
                        <small>${layout.equipment || "Rail-side operation"}</small>
                    </div>
                    <div class="terminal-block-stat">
                        <span class="terminal-block-ratio">${occupied}/${total}</span>
                        <small>${overviewGrid.footprintLabel} surface</small>
                    </div>
                </div>
                <div class="terminal-block-track">
                    <span class="terminal-block-track-line"></span>
                    <span class="terminal-block-footprint">${overviewGrid.footprintLabel}</span>
                    <span class="terminal-block-track-line"></span>
                </div>
                <div class="terminal-block-grid ${overviewGrid.className}" style="--mini-columns:${overviewGrid.columns}; --mini-rows:${overviewGrid.rows}; --mini-row-height:${overviewGrid.rowHeight}; --mini-gap:${overviewGrid.gap}; --mini-min-height:${overviewGrid.minHeight};">${renderMiniGrid(layout, overviewGrid)}</div>
                <div class="terminal-block-footer"><span>${blockContainers.length} containers</span><span>${percent}% loaded · ${layout.tierCount} tiers</span></div>
            </button>
        `;
    }).join("");
    overview.querySelectorAll(".terminal-block").forEach((button) => button.addEventListener("click", () => {
        state.selectedBlock = button.dataset.block;
        state.selectedSlotKey = null;
        state.selectedContainerId = null;
        if (state.moveDraftContainerId) state.moveTargetDraft.block = button.dataset.block;
        state.rowPage = 0;
        state.bayPage = 0;
        renderDashboard();
    }));
}

function getOverviewGridConfig(layout) {
    if (layout.block === "02") {
        return {
            columns: 28,
            rows: layout.rows.length,
            footprintLabel: `28 x ${layout.rows.length}`,
            className: "dense-overview-grid",
            rowHeight: "12px",
            gap: "0.16rem",
            minHeight: `${Math.max(96, layout.rows.length * 18)}px`,
        };
    }
    return {
        columns: layout.bays.length,
        rows: layout.rows.length,
        footprintLabel: layout.footprint,
        className: "",
        rowHeight: "16px",
        gap: "0.22rem",
        minHeight: "112px",
    };
}

function renderDenseOverviewMiniGrid(layout) {
    const cells = [];
    [...layout.rows].reverse().forEach((row, rowIndex) => {
        for (let column = 1; column <= 28; column += 1) {
            cells.push(`<span class="mini-cell type-empty" style="grid-column:${column};grid-row:${rowIndex + 1};"></span>`);
        }
    });

    [...layout.rows].reverse().forEach((row, rowIndex) => {
        const rendered = new Set();
        layout.bays.forEach((bay) => {
            const supportWideContainer = getCoveredWideSupportContainer(layout.block, bay, row);
            if (supportWideContainer) {
                const gridColumn = Math.min(parseBayNumber(getSurfaceStartBay(supportWideContainer)), 28);
                cells.push(`<span class="mini-cell type-${supportWideContainer.container_type} support-fragment dense-part" style="grid-column:${gridColumn};grid-row:${rowIndex + 1};"></span>`);
                return;
            }
            const coveringWideContainer = getCoveringWideContainer(layout.block, bay, row);
            if (coveringWideContainer) return;

            const anchoredWideContainer = getAnchoredWideContainer(layout.block, bay, row);
            if (anchoredWideContainer) {
                if (rendered.has(anchoredWideContainer.container_id)) return;
                const surfaceStartBay = getSurfaceStartBayFromWideAnchor(anchoredWideContainer.bay);
                const gridColumn = Math.min(parseBayNumber(surfaceStartBay), 28);
                cells.push(`<span class="mini-cell type-${anchoredWideContainer.container_type} wide dense-part" style="grid-column:${gridColumn} / span 2;grid-row:${rowIndex + 1};"></span>`);
                rendered.add(anchoredWideContainer.container_id);
                return;
            }

            const visibleContainer = getVisibleContainerForSlot(getSlotContainers(layout.block, bay, row));
            if (!visibleContainer || rendered.has(visibleContainer.container_id)) return;
            const gridColumn = Math.min(parseBayNumber(bay) + 1, 28);
            cells.push(`<span class="mini-cell type-${visibleContainer.container_type} dense-part" style="grid-column:${gridColumn};grid-row:${rowIndex + 1};"></span>`);
            rendered.add(visibleContainer.container_id);
        });
    });

    return cells.join("");
}

function renderMiniGrid(layout, overviewGrid = getOverviewGridConfig(layout)) {
    if (layout.block === "02") {
        return renderDenseOverviewMiniGrid(layout);
    }
    const cells = [];
    [...layout.rows].reverse().forEach((row, rowIndex) => {
        layout.bays.forEach((bay, bayIndex) => {
            const supportWideContainer = getCoveredWideSupportContainer(layout.block, bay, row);
            if (supportWideContainer) {
                cells.push(`<span class="mini-cell type-${supportWideContainer.container_type} support-fragment" style="grid-column:${bayIndex + 1};grid-row:${rowIndex + 1};"></span>`);
                return;
            }
            const coveringWideContainer = getCoveringWideContainer(layout.block, bay, row);
            if (coveringWideContainer) return;
            const anchoredWideContainer = getAnchoredWideContainer(layout.block, bay, row);
            if (anchoredWideContainer) {
                cells.push(`<span class="mini-cell type-${anchoredWideContainer.container_type} wide" style="grid-column:${bayIndex + 1} / span 2;grid-row:${rowIndex + 1};"></span>`);
                return;
            }
            const slot = getSlotRecord(layout.block, bay, row);
            const container = getVisibleContainerForSlot(getSlotContainers(layout.block, bay, row));
            const typeClass = !slot.enabled ? "type-disabled" : container ? `type-${container.container_type}` : "type-empty";
            cells.push(`<span class="mini-cell ${typeClass}" style="grid-column:${bayIndex + 1};grid-row:${rowIndex + 1};"></span>`);
        });
    });
    return cells.join("");
}

function renderBayGrid() {
    const layout = getBlockLayout(state.selectedBlock);
    const maxViewportSize = layout.bays.length;
    if (state.viewportSize > maxViewportSize) state.viewportSize = maxViewportSize;
    const visibleRows = getVisibleRows(layout);
    const visibleBays = getVisibleBays(layout);
    const isFullBlockView = state.viewportSize >= layout.bays.length;
    const isDenseView = visibleBays.length >= 10;
    setText("bay-panel-title", `${layout.label} · Block ${layout.block}`);
    setText("bay-panel-subtitle", state.tierVisibility === "top" ? `Top mode shows the highest container in each rail slot. 40ft and 45ft containers span two horizontal cells in the same row. ${layout.equipment || "Rail-side handling"}.` : `Tier ${state.tierVisibility} mode isolates one stack layer. Standard supports up to ${layout.tierCount} tiers.`);
    renderViewportControls(layout, visibleRows, visibleBays);

    const bayGrid = document.getElementById("bay-grid");
    const visualRows = [...visibleRows].reverse();
    const items = [`<span class="axis-cell" style="grid-column:1;grid-row:1;">Row</span>`];

    visibleBays.forEach((bay, bayIndex) => {
        items.push(`<span class="bay-header-cell" style="grid-column:${bayIndex + 2};grid-row:1;">${bay}</span>`);
    });

    visualRows.forEach((row, rowIndex) => {
        const gridRow = rowIndex + 2;
        items.push(`<span class="row-header-cell" style="grid-column:1;grid-row:${gridRow};">${row}</span>`);
        visibleBays.forEach((bay, bayIndex) => {
            const supportWideContainer = getCoveredWideSupportContainer(layout.block, bay, row);
            if (supportWideContainer) {
                items.push(renderWideSupportCell({
                    block: layout.block,
                    bay,
                    row,
                    container: supportWideContainer,
                    gridColumn: bayIndex + 2,
                    gridRow,
                }));
                return;
            }
            const coveringWideContainer = getCoveringWideContainer(layout.block, bay, row);
            if (coveringWideContainer) return;
            const anchoredWideContainer = getAnchoredWideContainer(layout.block, bay, row);
            if (anchoredWideContainer) {
                const anchorBay = anchoredWideContainer.bay;
                const anchorSlotRecord = getSlotRecord(layout.block, bay, row);
                const anchorSlotContainers = getSlotContainers(layout.block, bay, row);
                items.push(renderSlotCell({
                    block: layout.block,
                    bay: anchorBay,
                    row,
                    slotRecord: anchorSlotRecord,
                    slotContainers: anchorSlotContainers,
                    visibleContainer: anchoredWideContainer,
                    tierCount: layout.tierCount,
                    gridColumn: bayIndex + 2,
                    gridRow,
                    spanCols: 2,
                    condensed: isDenseView,
                }));
                return;
            }
            const slotRecord = getSlotRecord(layout.block, bay, row);
            const slotContainers = getSlotContainers(layout.block, bay, row);
            const visibleContainer = getVisibleContainerForSlot(slotContainers);
            const spanCols = canContainerSpanHorizontal(visibleContainer) ? 2 : 1;
            items.push(renderSlotCell({
                block: layout.block,
                bay,
                row,
                slotRecord,
                slotContainers,
                visibleContainer,
                tierCount: layout.tierCount,
                gridColumn: bayIndex + 2,
                gridRow,
                spanCols,
                condensed: isDenseView,
            }));
        });
    });

    const bayCellWidth = visibleBays.length > 12 ? 44 : visibleBays.length > 10 ? 52 : 72;
    bayGrid.classList.toggle("compact-grid", visibleBays.length > 12);
    bayGrid.classList.toggle("condensed-grid", isDenseView);
    bayGrid.style.gridTemplateColumns = `72px repeat(${visibleBays.length}, minmax(${bayCellWidth}px, 1fr))`;
    bayGrid.style.gridAutoRows = visibleBays.length > 12 ? "72px" : visibleBays.length > 10 ? "78px" : "88px";
    bayGrid.innerHTML = items.join("");
}

function renderWideSupportCell({ block, bay, row, container, gridColumn, gridRow }) {
    const slotKey = getSlotKey(block, bay, row);
    const slotRecord = getSlotRecord(block, bay, row);
    const slotContainers = getSlotContainers(block, bay, row);
    const visibleContainer = getVisibleContainerForSlot(slotContainers) || getTopContainer(slotContainers);
    const isSelected = state.selectedSlotKey === slotKey;
    const isMoveTarget = state.moveDraftContainerId && state.selectedSlotKey === slotKey;
    const isDragHover = state.dragOverSlotKey === slotKey;
    const canDropHere = Boolean(state.draggingContainerId && canDropContainerOnSlot(state.draggingContainerId, slotKey));
    const classes = [
        "slot-cell",
        "slot-support-fragment",
        isSelected ? "is-selected" : "",
        isMoveTarget ? "is-target" : "",
        isDragHover ? "is-drop-target" : "",
        canDropHere ? "is-drop-candidate" : "",
        !slotRecord.enabled ? "is-disabled" : "",
        `type-${container.container_type}`,
        Number(bay) % 2 === 0 ? "parity-even" : "parity-odd",
    ].filter(Boolean).join(" ");

    return `
        <button
            type="button"
            class="${classes}"
            style="grid-column:${gridColumn};grid-row:${gridRow};"
            data-slot-key="${slotKey}"
            data-container-id="${visibleContainer ? visibleContainer.container_id : ""}"
            draggable="false"
            aria-label="Support slot ${block}-${bay}-${row}"
            title="Support slot ${block}-${bay}-${row}"
        ></button>
    `;
}

function renderSlotCell({ block, bay, row, slotRecord, slotContainers, visibleContainer, tierCount, gridColumn, gridRow, spanCols, condensed = false }) {
    const slotBay = visibleContainer && canContainerSpanHorizontal(visibleContainer) ? getSurfaceStartBayFromWideAnchor(bay) : bay;
    const slotKey = getSlotKey(block, slotBay, row);
    const alternateSlotKey = spanCols === 2 && visibleContainer && canContainerSpanHorizontal(visibleContainer)
        ? getCoveredSurfaceSlotKey(visibleContainer)
        : null;
    const slotKeys = [slotKey, alternateSlotKey].filter(Boolean);
    const isSelected = slotKeys.includes(state.selectedSlotKey);
    const isMoveTarget = state.moveDraftContainerId && slotKeys.includes(state.selectedSlotKey);
    const isDragHover = slotKeys.includes(state.dragOverSlotKey);
    const canDrag = Boolean(visibleContainer && state.currentUser?.permissions?.includes("restow"));
    const canDropHere = Boolean(
        state.draggingContainerId
        && slotKeys.some((candidateSlotKey) => canDropContainerOnSlot(state.draggingContainerId, candidateSlotKey))
    );
    const title = condensed ? (visibleContainer ? `T${visibleContainer.tier_num}` : slotRecord.enabled ? "" : "X") : visibleContainer ? visibleContainer.container_id : slotRecord.enabled ? "Free" : "Blocked";
    const meta = condensed ? "" : visibleContainer ? `${visibleContainer.container_type.toUpperCase()} · Tier ${visibleContainer.tier_num}` : slotRecord.enabled ? "" : "Blocked slot";
    const code = condensed ? "" : `${block}-${bay}-${row}`;
    const classes = [
        "slot-cell",
        isSelected ? "is-selected" : "",
        isMoveTarget ? "is-target" : "",
        isDragHover ? "is-drop-target" : "",
        canDropHere ? "is-drop-candidate" : "",
        canDrag ? "is-draggable" : "",
        !slotRecord.enabled ? "is-disabled" : "",
        visibleContainer ? `type-${visibleContainer.container_type}` : "type-empty",
        Number(bay) % 2 === 0 ? "parity-even" : "parity-odd",
        spanCols === 2 ? "wide" : "",
    ].filter(Boolean).join(" ");

    return `
        <button type="button" class="${classes}" style="grid-column:${gridColumn} / span ${spanCols};grid-row:${gridRow};" data-slot-key="${slotKey}" data-alt-slot-key="${alternateSlotKey || ""}" data-container-id="${visibleContainer ? visibleContainer.container_id : ""}" draggable="${canDrag ? "true" : "false"}">
            ${code ? `<span class="slot-code">${code}</span>` : ""}
            <strong class="slot-title">${title}</strong>
            ${meta ? `<span class="slot-meta">${meta}</span>` : ""}
            <span class="slot-stack">${slotContainers.length}/${slotRecord.max_tiers || tierCount}</span>
        </button>
    `;
}

async function loadAdminUsers() {
    if (!state.currentUser?.permissions?.includes("manage_users")) return;
    const response = await apiFetch(`${API_ROOT}/admin/users`);
    if (!response.ok) {
        showToast("Failed to load users.", "error");
        return;
    }
    state.adminUsers = await response.json();
    if (state.selectedAdminUser) state.selectedAdminUser = state.adminUsers.find((user) => user.username === state.selectedAdminUser.username) || null;
    renderAdminUsers();
}

function renderAdminUsers() {
    const tbody = document.getElementById("admin-users-list");
    const canManageUsers = Boolean(state.currentUser?.permissions?.includes("manage_users"));
    if (!canManageUsers) {
        tbody.innerHTML = "";
        renderAdminUserInspector();
        return;
    }
    tbody.innerHTML = state.adminUsers.map((user) => `<tr data-admin-username="${user.username}"><td><strong>${user.full_name}</strong><br><small>@${user.username}</small></td><td>${user.role}</td><td>${user.telegram_chat_id || "-"}</td><td>${user.telegram_notifications_enabled ? "Telegram" : "Off"}</td></tr>`).join("");
    tbody.querySelectorAll("tr[data-admin-username]").forEach((row) => row.addEventListener("click", () => {
        state.selectedAdminUser = state.adminUsers.find((user) => user.username === row.dataset.adminUsername) || null;
        renderAdminUserInspector();
    }));
    renderAdminUserInspector();
}

function renderAdminUserInspector() {
    const empty = document.getElementById("admin-user-empty");
    const content = document.getElementById("admin-user-content");
    const badge = document.getElementById("admin-user-badge");
    const deleteButton = document.getElementById("admin-delete-user-button");
    const deleteHint = document.getElementById("admin-delete-user-hint");
    if (!state.currentUser?.permissions?.includes("manage_users") || !state.selectedAdminUser) {
        empty.classList.remove("hidden");
        content.classList.add("hidden");
        badge.textContent = state.currentUser?.permissions?.includes("manage_users") ? "No user" : "No access";
        return;
    }
    empty.classList.add("hidden");
    content.classList.remove("hidden");
    badge.textContent = state.selectedAdminUser.role;
    setText("admin-detail-username", `@${state.selectedAdminUser.username}`);
    setText("admin-detail-fullname", state.selectedAdminUser.full_name);
    setText("admin-detail-role", state.selectedAdminUser.role);
    setText("admin-detail-permissions", state.selectedAdminUser.permissions.join(", "));
    document.getElementById("admin-role-select").value = state.selectedAdminUser.role;
    if (deleteButton) {
        const isSelf = state.currentUser?.username === state.selectedAdminUser.username;
        deleteButton.disabled = Boolean(isSelf);
        deleteButton.textContent = isSelf ? "Delete User (Unavailable)" : "Delete User";
    }
    if (deleteHint) {
        deleteHint.textContent = state.currentUser?.username === state.selectedAdminUser.username
            ? "You cannot delete the account you are currently using."
            : "Delete revokes access immediately and preserves operation history.";
    }
}

function renderAdminBlocks() {
    const tbody = document.getElementById("admin-blocks-list");
    if (!state.currentUser?.permissions?.includes("manage_layout")) {
        tbody.innerHTML = "";
        renderAdminBlockInspector();
        return;
    }
    const blocks = state.layoutConfig.length ? state.layoutConfig : DEFAULT_LAYOUT;
    tbody.innerHTML = blocks.map((block) => `<tr data-admin-block="${block.block}"><td><strong>${block.block}</strong></td><td>${block.label}</td><td>${block.bay_count || block.bayCount}</td><td>${block.row_count || block.rowCount}</td><td>${block.tier_count || block.tierCount}</td></tr>`).join("");
    tbody.querySelectorAll("tr[data-admin-block]").forEach((row) => row.addEventListener("click", () => {
        const blocksList = state.layoutConfig.length ? state.layoutConfig : DEFAULT_LAYOUT;
        const block = blocksList.find((entry) => entry.block === row.dataset.adminBlock);
        state.selectedAdminBlock = block || null;
        state.selectedAdminSlot = null;
        state.selectedBlock = block?.block || state.selectedBlock;
        state.rowPage = 0;
        state.bayPage = 0;
        renderAdminBlockInspector();
        renderAdminSlots();
        renderDashboard();
    }));
    if (state.selectedAdminBlock) state.selectedAdminBlock = blocks.find((item) => item.block === state.selectedAdminBlock.block) || null;
    renderAdminBlockInspector();
    renderAdminSlots();
}

function renderAdminBlockInspector() {
    const empty = document.getElementById("admin-block-empty");
    const content = document.getElementById("admin-block-content");
    const badge = document.getElementById("admin-block-badge");
    if (!state.currentUser?.permissions?.includes("manage_layout") || !state.selectedAdminBlock) {
        empty.classList.remove("hidden");
        content.classList.add("hidden");
        badge.textContent = state.currentUser?.permissions?.includes("manage_layout") ? "No block" : "No access";
        return;
    }
    empty.classList.add("hidden");
    content.classList.remove("hidden");
    badge.textContent = state.selectedAdminBlock.block;
    setText("admin-block-code", `Block ${state.selectedAdminBlock.block}`);
    setText("admin-block-label", `${state.selectedAdminBlock.label} · ${state.selectedAdminBlock.equipment || "no equipment"}`);
    setValue("admin-block-name", state.selectedAdminBlock.label);
    setValue("admin-block-bays", String(state.selectedAdminBlock.bay_count || state.selectedAdminBlock.bayCount));
    setValue("admin-block-rows", String(state.selectedAdminBlock.row_count || state.selectedAdminBlock.rowCount));
    setValue("admin-block-tiers", String(state.selectedAdminBlock.tier_count || state.selectedAdminBlock.tierCount));
    setValue("admin-block-equipment", state.selectedAdminBlock.equipment || "");
}

function renderAdminSlots() {
    const tbody = document.getElementById("admin-slots-list");
    if (!state.currentUser?.permissions?.includes("manage_layout")) {
        tbody.innerHTML = "";
        renderAdminSlotInspector();
        return;
    }
    const activeBlock = state.selectedAdminBlock?.block || getTerminalLayout()[0].block;
    const layout = getBlockLayout(activeBlock);
    const visibleRows = getVisibleRows(layout);
    const visibleBays = getVisibleBays(layout);
    const slots = getBlockSlotRecords(activeBlock).filter((slot) => visibleBays.includes(slot.bay) && visibleRows.includes(Number(slot.row_num)));
    tbody.innerHTML = slots.map((slot) => `<tr data-admin-slot="${slot.slot_code}"><td><strong>${slot.slot_code}</strong></td><td>${slot.enabled ? "Open" : "Blocked"}</td><td>${slot.allowed_container_types.join(", ")}</td><td>${slot.max_tiers}</td></tr>`).join("");
    tbody.querySelectorAll("tr[data-admin-slot]").forEach((row) => row.addEventListener("click", () => {
        state.selectedAdminSlot = slots.find((slot) => slot.slot_code === row.dataset.adminSlot) || null;
        renderAdminSlotInspector();
    }));
    if (state.selectedAdminSlot) state.selectedAdminSlot = slots.find((slot) => slot.slot_code === state.selectedAdminSlot.slot_code) || null;
    setText("admin-slot-subtitle", `Showing current viewport for block ${activeBlock}: bays ${visibleBays[0]}-${visibleBays[visibleBays.length - 1]}, rows ${visibleRows[0]}-${visibleRows[visibleRows.length - 1]}.`);
    renderAdminSlotInspector();
}

function renderAdminSlotInspector() {
    const empty = document.getElementById("admin-slot-empty");
    const content = document.getElementById("admin-slot-content");
    const badge = document.getElementById("admin-slot-badge");
    if (!state.currentUser?.permissions?.includes("manage_layout") || !state.selectedAdminSlot) {
        empty.classList.remove("hidden");
        content.classList.add("hidden");
        badge.textContent = state.currentUser?.permissions?.includes("manage_layout") ? "No slot" : "No access";
        return;
    }
    empty.classList.add("hidden");
    content.classList.remove("hidden");
    badge.textContent = state.selectedAdminSlot.enabled ? "Open" : "Blocked";
    setText("admin-slot-code", state.selectedAdminSlot.slot_code);
    setText("admin-slot-summary", `${state.selectedAdminSlot.allowed_container_types.join(", ")} · max ${state.selectedAdminSlot.max_tiers} tiers`);
    setChecked("admin-slot-blocked", !state.selectedAdminSlot.enabled);
    setValue("admin-slot-tiers", String(state.selectedAdminSlot.max_tiers));
    setChecked("slot-type-20ft", state.selectedAdminSlot.allowed_container_types.includes("20ft"));
    setChecked("slot-type-40ft", state.selectedAdminSlot.allowed_container_types.includes("40ft"));
    setChecked("slot-type-45ft", state.selectedAdminSlot.allowed_container_types.includes("45ft"));
    setValue("admin-slot-notes", state.selectedAdminSlot.notes || "");
}

function renderInventoryTable() {
    const inventoryList = document.getElementById("inventory-list");
    const summary = document.getElementById("inventory-summary");
    const filteredInventory = getFilteredInventory();
    if (summary) {
        summary.textContent = state.inventorySearchQuery.trim()
            ? `Showing ${filteredInventory.length} of ${state.inventory.length} container(s) matching "${state.inventorySearchQuery.trim()}".`
            : "Table view for operational cross-checking and printing the current yard state.";
    }
    if (!state.inventory.length) {
        inventoryList.innerHTML = `<tr><td colspan="5" style="text-align:center;">No container data</td></tr>`;
        return;
    }
    if (!filteredInventory.length) {
        inventoryList.innerHTML = `<tr><td colspan="5" style="text-align:center;">No containers match the current search.</td></tr>`;
        return;
    }
    inventoryList.innerHTML = filteredInventory.map((item) => `<tr data-container-id="${item.container_id}"><td><strong>${item.container_id}</strong></td><td>${item.container_type}</td><td><span class="tag">${item.position_code}</span></td><td>${item.status}</td><td>${item.direction}</td></tr>`).join("");
    inventoryList.querySelectorAll("tr[data-container-id]").forEach((row) => row.addEventListener("click", () => {
        const container = findContainerById(row.dataset.containerId);
        if (!container) return;
        const previousBlock = state.selectedBlock;
        state.selectedBlock = container.block;
        state.selectedSlotKey = getSlotKey(container.block, getSurfaceStartBay(container), container.row_num);
        state.selectedContainerId = container.container_id;
        ensureSlotVisible(container.block, container.bay, container.row_num);
        ensureContainerHistory(container.container_id);
        syncFormsFromSelection({ forceStackIn: true, markStackInPositionDirty: true });
        openTab("dashboard-tab");
        renderDashboard({
            stats: previousBlock !== state.selectedBlock,
            overview: previousBlock !== state.selectedBlock,
            inventory: false,
            activity: false,
        });
    }));
}

function renderInspector() {
    const empty = document.getElementById("inspector-empty");
    const content = document.getElementById("inspector-content");
    const badge = document.getElementById("selected-position-badge");
    const moveButton = document.getElementById("prefill-restow");
    const stackOutButton = document.getElementById("prefill-stackout");
    if (!state.selectedSlotKey) {
        empty.classList.remove("hidden");
        content.classList.add("hidden");
        badge.textContent = `Block ${state.selectedBlock}`;
        setText("inspector-subtitle", "Select a slot or container on the map.");
        return;
    }
    const parsed = parseSlotKey(state.selectedSlotKey);
    const layout = getBlockLayout(parsed.block);
    const slotRecord = getSlotRecord(parsed.block, parsed.bay, parsed.row);
    const slotContainers = getSlotContainers(parsed.block, parsed.bay, parsed.row);
    const nextTier = getNextAvailableTier(slotContainers, slotRecord.max_tiers || layout.tierCount);
    const selectedContainer = getSelectedContainer(slotContainers);
    empty.classList.add("hidden");
    content.classList.remove("hidden");
    const selectedAddress = selectedContainer && isWideContainer(selectedContainer)
        ? `${selectedContainer.block}-${selectedContainer.bay}-${selectedContainer.row_num}`
        : `${parsed.block}-${parsed.bay}-${parsed.row}`;
    badge.textContent = selectedAddress;
    badge.className = `slot-badge ${selectedContainer ? `type-${selectedContainer.container_type}` : "neutral"}`;
    setText("inspector-subtitle", state.moveDraftContainerId ? `Move mode armed for ${state.moveDraftContainerId}. Pick a target slot on the map.` : "Stack details, current container and audit trail for the selected slot.");
    setText("detail-slot", selectedAddress);
    setText("detail-rule", slotRecord.enabled ? `Allowed types: ${slotRecord.allowed_container_types.join(", ")}` : "Slot blocked in directory");
    setText("detail-capacity", `${slotContainers.length} / ${slotRecord.max_tiers || layout.tierCount} tiers occupied`);
    setText("detail-next-tier", nextTier ? `Next free tier: ${nextTier} of ${slotRecord.max_tiers || layout.tierCount}` : slotRecord.enabled ? "Stack is full" : "Slot blocked");
    document.getElementById("selected-container-card").innerHTML = selectedContainer
        ? `
            <span class="detail-label">Selected container</span>
            <strong>${escapeHtml(selectedContainer.container_id)}</strong>
            <small>${escapeHtml(selectedContainer.container_type)} · ${escapeHtml(selectedContainer.status)} · ${escapeHtml(selectedContainer.direction)}</small>
            <small>${escapeHtml(selectedContainer.position_code)}</small>
            <div class="container-card-meta">
                <div class="container-card-chip"><strong>Bonded</strong><span>${selectedContainer.bonded ? "Yes" : "No"}</span></div>
                <div class="container-card-chip"><strong>Stack Out</strong><span>${escapeHtml(formatShortDate(selectedContainer.stack_out_date) || "Not set")}</span></div>
                <div class="container-card-chip"><strong>Weight</strong><span>${escapeHtml(formatWeight(selectedContainer.weight) || "Not set")}</span></div>
                <div class="container-card-chip"><strong>Commodity</strong><span>${escapeHtml(selectedContainer.commodity || "Not set")}</span></div>
                <div class="container-card-chip"><strong>Line</strong><span>${escapeHtml(selectedContainer.line || "Not set")}</span></div>
                <div class="container-card-chip"><strong>Arrival</strong><span>${escapeHtml(formatShortDate(selectedContainer.arrived_at) || "Not set")}</span></div>
            </div>
        `
        : `<span class="detail-label">Selected container</span><strong>${slotRecord.enabled ? "Slot is free" : "Slot is blocked"}</strong><small>${slotRecord.enabled ? "Use this address for Stack In or as a Restow target." : "Admin must unblock this slot before it can accept containers."}</small>`;
    renderTargetMoveWidget();
    renderStackLayers(slotContainers);
    renderHistory(selectedContainer ? selectedContainer.container_id : null);
    renderRoutingPreview(selectedContainer);
    syncFormsFromSelection({ forceOtherForms: true });
    moveButton.innerHTML = state.moveDraftContainerId ? `<i class="fa-solid fa-xmark"></i> Cancel Map Target` : `<i class="fa-solid fa-location-crosshairs"></i> Pick Target On Map`;
    moveButton.disabled = !selectedContainer && !state.moveDraftContainerId;
    stackOutButton.disabled = !selectedContainer;
}

function getFilteredInventory() {
    const query = state.inventorySearchQuery.trim().toLowerCase();
    if (!query) return state.inventory;
    return state.inventory.filter((item) => String(item.container_id || "").toLowerCase().includes(query));
}

function getMoveDraftContainer() {
    if (state.moveDraftContainerId) {
        return findContainerById(state.moveDraftContainerId);
    }
    return state.selectedContainerId ? findContainerById(state.selectedContainerId) : null;
}

function listAllowedWideBays(block) {
    const bays = [];
    for (let bay = 2; bay <= getMaxWideBay(block); bay += 4) {
        bays.push(formatBayNumber(bay));
    }
    return bays;
}

function getTargetMoveHelper(container, targetBlock = container?.block) {
    if (!container) return "Arm a container to enter a target bay and row.";
    if (container.container_type === "20ft") {
        return `20ft: use odd bays in block ${targetBlock} like 01, 03, 05, 07...`;
    }
    if (container.container_type === "40ft") {
        return `40ft: use wide bays ${listAllowedWideBays(targetBlock).join(", ")} in block ${targetBlock}.`;
    }
    return `45ft: only edge bays ${formatBayNumber(2)} and ${formatBayNumber(getMaxWideBay(targetBlock))} are allowed in block ${targetBlock}.`;
}

function resolveTargetMoveFromDraft() {
    const movingContainer = getMoveDraftContainer();
    if (!movingContainer) return { error: "Select a container and arm move mode first." };
    const targetBlock = state.moveTargetDraft.block || movingContainer.block;
    const rawBay = state.moveTargetDraft.bay.trim();
    const rawRow = state.moveTargetDraft.row.trim();
    if (!rawBay || !rawRow) return { error: "", incomplete: true };

    const bayValue = Number(rawBay);
    const rowValue = Number(rawRow);
    const layout = getBlockLayout(targetBlock);
    if (!Number.isInteger(bayValue) || bayValue < 1 || bayValue > getMaxSurfaceBay(targetBlock)) {
        return { error: `Bay must be between 1 and ${getMaxSurfaceBay(targetBlock)}.` };
    }
    if (!Number.isInteger(rowValue) || rowValue < 1 || rowValue > layout.rows.length) {
        return { error: `Row must be between 1 and ${layout.rows.length}.` };
    }

    const bay = formatBayNumber(bayValue);
    if (!isWideContainer(movingContainer) && !isSurfaceBay(bay)) {
        return { error: "20ft containers can be moved only to odd bays like 01, 03, 05..." };
    }
    if (movingContainer.container_type === "40ft" && (isSurfaceBay(bay) || parseBayNumber(bay) % 4 !== 2)) {
        return { error: `40ft containers use wide bays ${listAllowedWideBays(targetBlock).join(", ")}.` };
    }
    if (movingContainer.container_type === "45ft") {
        const lastWideBay = formatBayNumber(getMaxWideBay(targetBlock));
        if (isSurfaceBay(bay)) {
            return { error: `45ft containers use edge bays 02 and ${lastWideBay} only.` };
        }
        if (!is45ftAnchorAllowed(targetBlock, bay)) {
            return { error: `45ft containers can be moved only to 02 or ${lastWideBay} in block ${targetBlock}.` };
        }
    }
    const targetSlotKey = isWideContainer(movingContainer)
        ? getSlotKey(targetBlock, getSurfaceStartBayFromWideAnchor(bay), rowValue)
        : getSlotKey(targetBlock, bay, rowValue);
    const moveTarget = resolveMoveTarget(movingContainer.container_id, targetSlotKey);
    if (moveTarget.error) return moveTarget;
    return { moveTarget, targetSlotKey };
}

function renderTargetMoveWidget() {
    const widget = document.getElementById("target-move-widget");
    const containerEl = document.getElementById("target-move-container");
    const blockEl = document.getElementById("target-move-block");
    const helperEl = document.getElementById("target-move-helper");
    const feedbackEl = document.getElementById("target-move-feedback");
    const submitButton = document.getElementById("target-move-submit");
    const movingContainer = getMoveDraftContainer();

    if (!widget || !containerEl || !blockEl || !helperEl || !feedbackEl || !submitButton) return;
    if (!movingContainer) {
        widget.classList.add("hidden");
        state.quickMoveContainerId = null;
        submitButton.disabled = true;
        return;
    }

    if (state.quickMoveContainerId !== movingContainer.container_id) {
        state.quickMoveContainerId = movingContainer.container_id;
        resetMoveTargetDraft(movingContainer.row_num || "", movingContainer.block);
    }

    widget.classList.remove("hidden");
    const targetBlock = state.moveTargetDraft.block || movingContainer.block;
    containerEl.textContent = `${movingContainer.container_id} · ${movingContainer.container_type}`;
    blockEl.textContent = `Target block: ${targetBlock}`;
    helperEl.textContent = getTargetMoveHelper(movingContainer, targetBlock);
    setValue("target-move-bay", state.moveTargetDraft.bay);
    setValue("target-move-row", state.moveTargetDraft.row);

    const resolution = resolveTargetMoveFromDraft();
    feedbackEl.className = "target-move-feedback neutral";
    if (resolution.incomplete) {
        feedbackEl.textContent = "Enter target bay and row. The system will accept only a valid address for this container type.";
        submitButton.disabled = true;
        return;
    }
    if (resolution.error) {
        feedbackEl.textContent = resolution.error;
        feedbackEl.className = "target-move-feedback error";
        submitButton.disabled = true;
        return;
    }

    const { moveTarget } = resolution;
    if (moveTarget.departureRuleConflict) {
        feedbackEl.textContent = `Emergency override required: ${moveTarget.departureRuleConflict.message}`;
        feedbackEl.className = "target-move-feedback warning";
    } else {
        feedbackEl.textContent = `Ready: ${moveTarget.target.block}-${moveTarget.target.bay}-${moveTarget.target.row}-${moveTarget.nextTier}`;
        feedbackEl.className = "target-move-feedback success";
    }
    submitButton.disabled = false;
}

async function submitTargetMove() {
    const resolution = resolveTargetMoveFromDraft();
    if (resolution.incomplete) {
        showToast("Enter both target bay and target row.", "error");
        return;
    }
    if (resolution.error) {
        showToast(resolution.error, "error");
        return;
    }
    if (resolution.moveTarget.departureRuleConflict) {
        openMoveConfirmModal({ ...resolution.moveTarget, targetSlotKey: resolution.targetSlotKey });
        return;
    }
    await executeRestowMove(resolution.moveTarget, resolution.targetSlotKey, {
        buttonId: "target-move-submit",
        label: "Moving to target...",
    });
    resetMoveTargetDraft();
}

function renderStackLayers(slotContainers) {
    const stack = document.getElementById("stack-layers");
    if (!slotContainers.length) {
        stack.innerHTML = `<div class="layer-empty">Slot is free. Pick it as a target for a new or moved container.</div>`;
        return;
    }
    stack.innerHTML = [...slotContainers].sort((a, b) => b.tier_num - a.tier_num).map((container) => `<button type="button" class="layer-item ${container.container_id === state.selectedContainerId ? "active" : ""}" data-container-id="${container.container_id}"><span class="layer-tier">Tier ${container.tier_num}</span><span class="layer-id">${container.container_id}</span><span class="layer-type">${container.container_type}</span></button>`).join("");
    stack.querySelectorAll(".layer-item").forEach((button) => button.addEventListener("click", () => {
        state.selectedContainerId = button.dataset.containerId;
        ensureContainerHistory(state.selectedContainerId);
        renderInspector();
    }));
}

function renderHistory(containerId) {
    const history = document.getElementById("container-history");
    if (!containerId) {
        history.innerHTML = `<div class="history-empty">Pick a container in the stack to inspect its route.</div>`;
        return;
    }
    if (!state.containerHistory.has(containerId)) {
        history.innerHTML = `<div class="history-empty">Loading container history...</div>`;
        ensureContainerHistory(containerId);
        return;
    }
    const records = state.containerHistory.get(containerId);
    if (records === null) {
        history.innerHTML = `<div class="history-empty">Loading container history...</div>`;
        return;
    }
    if (!records.length) {
        history.innerHTML = `<div class="history-empty">No history found yet.</div>`;
        return;
    }
    history.innerHTML = records.map((entry) => {
        const route = entry.old_position_code ? `${entry.old_position_code} -> ${entry.new_position_code || "OUT"}` : entry.new_position_code || "IN";
        const actor = entry.operator_full_name || entry.operator_username || "System";
        return `<div class="history-item"><strong>${humanizeOperation(entry.operation_type)}</strong><span>${route}</span><small>${actor} · ${formatDateTime(entry.performed_at)}</small></div>`;
    }).join("");
}

function renderActivityFeed() {
    const feed = document.getElementById("activity-feed");
    if (!state.logs.length) {
        feed.innerHTML = `<div class="history-empty">No recent activity loaded.</div>`;
        return;
    }
    const recent = [...state.logs].slice(-8).reverse();
    feed.innerHTML = recent.map((entry) => {
        const actor = entry.operator_full_name || entry.operator_username || "System";
        const route = entry.old_position_code ? `${entry.old_position_code} -> ${entry.new_position_code || "OUT"}` : entry.new_position_code || "IN";
        return `<div class="history-item"><strong>${actor} · ${humanizeOperation(entry.operation_type)}</strong><span>${entry.container_id} · ${route}</span><small>${formatDateTime(entry.performed_at)}</small></div>`;
    }).join("");
}

async function ensureContainerHistory(containerId) {
    if (!containerId || state.containerHistory.has(containerId)) return;
    state.containerHistory.set(containerId, null);
    renderHistory(containerId);
    try {
        const response = await apiFetch(`${API_BASE_URL}/history/${containerId}`);
        if (response.status === 404) {
            state.containerHistory.set(containerId, []);
            renderHistory(containerId);
            return;
        }
        if (!response.ok) throw new Error();
        state.containerHistory.set(containerId, await response.json());
        renderHistory(containerId);
    } catch {
        state.containerHistory.set(containerId, []);
        renderHistory(containerId);
    }
}

function renderRoutingPreview(selectedContainer) {
    const preview = document.getElementById("routing-preview");
    if (!selectedContainer) {
        preview.innerHTML = `<div class="history-empty">Select a container to inspect who gets notified.</div>`;
        return;
    }
    preview.innerHTML = `<div class="history-empty">Routing preview available after live notification requests.</div>`;
}

function handleSlotClick(slotKey, containerId) {
    if (state.moveDraftContainerId) {
        handleMoveTargetSelection(slotKey);
        return;
    }
    const previousBlock = state.selectedBlock;
    state.selectedSlotKey = slotKey;
    const parsed = parseSlotKey(slotKey);
    state.selectedBlock = parsed.block;
    ensureSlotVisible(parsed.block, parsed.bay, parsed.row);
    const slotContainers = getSlotContainers(parsed.block, parsed.bay, parsed.row);
    const visibleContainer = slotContainers.find((container) => container.container_id === containerId) || getVisibleContainerForSlot(slotContainers) || getTopContainer(slotContainers);
    state.selectedContainerId = visibleContainer ? visibleContainer.container_id : null;
    if (state.selectedContainerId) ensureContainerHistory(state.selectedContainerId);
    syncFormsFromSelection({ forceStackIn: true, markStackInPositionDirty: true });
    renderSelectionState(previousBlock !== state.selectedBlock);
}

function handleMoveTargetSelection(targetSlotKey) {
    const moveTarget = resolveMoveTarget(state.moveDraftContainerId, targetSlotKey);
    if (moveTarget.error) {
        showToast(moveTarget.error, "error");
        return;
    }
    const previousBlock = state.selectedBlock;
    state.selectedSlotKey = targetSlotKey;
    state.selectedContainerId = moveTarget.movingContainer.container_id;
    state.selectedBlock = moveTarget.target.block;
    state.moveTargetDraft.block = moveTarget.target.block;
    ensureSlotVisible(moveTarget.target.block, moveTarget.target.bay, moveTarget.target.row);
    state.moveTargetDraft.bay = moveTarget.target.bay;
    state.moveTargetDraft.row = String(moveTarget.target.row);
    renderSelectionState(previousBlock !== state.selectedBlock);
    showToast(`Target prepared: ${moveTarget.target.block}-${moveTarget.target.bay}-${moveTarget.target.row}-${moveTarget.nextTier}. Press OK to move.`, "success");
}

function resolveMoveTarget(containerId, targetSlotKey) {
    const movingContainer = findContainerById(containerId);
    if (!movingContainer) return { error: "Source container no longer exists." };
    const targetSurface = parseSlotKey(targetSlotKey);
    const targetBay = getActualBayForPlacement(movingContainer.container_type, targetSurface.block, targetSurface.bay);
    if (!targetBay) return { error: `${movingContainer.container_type} cannot be placed at this bay.` };
    const target = { ...targetSurface, bay: targetBay };
    const sourceKey = getSlotKey(movingContainer.block, getSurfaceStartBay(movingContainer), movingContainer.row_num);
    if (sourceKey === targetSlotKey) return { error: "Choose a different target slot." };
    const slotRecord = getSlotRecord(targetSurface.block, targetSurface.bay, targetSurface.row);
    if (!slotRecord.enabled) return { error: "Selected slot is blocked in the slot directory." };
    if (!slotRecord.allowed_container_types.includes(movingContainer.container_type)) return { error: `Selected slot does not allow ${movingContainer.container_type}.` };
    const nextTier = getNextAvailableTier(getSlotContainers(targetSurface.block, targetSurface.bay, targetSurface.row), slotRecord.max_tiers);
    if (!nextTier) return { error: "No free tier in the selected stack." };
    const directionConflict = getBayDirectionConflict({
        block: target.block,
        bay: target.bay,
        direction: movingContainer.direction,
        containerType: movingContainer.container_type,
        excludeContainerId: movingContainer.container_id,
    });
    if (directionConflict) {
        return {
            error: `Bay ${target.block}-${target.bay} already contains ${directionConflict.direction} container ${directionConflict.container_id}. Import and Export cannot be mixed in one bay.`,
        };
    }
    if (!hasSupportingBase(target.block, target.bay, target.row, nextTier, movingContainer.container_type)) {
        return { error: `${movingContainer.container_type} is not supported by the tier below in this slot.` };
    }
    const occupant = findPositionOccupant(target.block, target.bay, target.row, nextTier, movingContainer.container_type, movingContainer.container_id);
    if (occupant) return { error: `Selected slot is already occupied by ${occupant.container_id} on tier ${nextTier}.` };
    const departureRuleConflict = getDeparturePriorityConflict({
        block: target.block,
        bay: target.bay,
        row: target.row,
        tier: nextTier,
        containerType: movingContainer.container_type,
        stackOutDate: movingContainer.stack_out_date,
        arrivedAt: movingContainer.arrived_at,
        excludeContainerId: movingContainer.container_id,
    });
    if (departureRuleConflict && !canUseEmergencyDepartureOverride()) {
        return { error: `Stacking order blocked: ${departureRuleConflict.message}` };
    }
    return { movingContainer, target, slotRecord, nextTier, departureRuleConflict };
}

function canDropContainerOnSlot(containerId, targetSlotKey) {
    return !resolveMoveTarget(containerId, targetSlotKey).error;
}

async function executeRestowMove(containerIdOrMoveTarget, targetSlotKey, options = {}) {
    const moveTarget = typeof containerIdOrMoveTarget === "object" ? containerIdOrMoveTarget : resolveMoveTarget(containerIdOrMoveTarget, targetSlotKey);
    if (moveTarget.error) {
        showToast(moveTarget.error, "error");
        return;
    }
    const emergencyOverride = Boolean(options.emergencyOverride || moveTarget.emergencyOverride);
    const overrideReason = (options.overrideReason || moveTarget.overrideReason || "").trim();
    if (moveTarget.departureRuleConflict && !emergencyOverride) {
        showToast("Emergency override must be enabled for this move.", "error");
        return;
    }
    if (moveTarget.departureRuleConflict && !overrideReason) {
        showToast("Enter a reason for the emergency override.", "error");
        return;
    }
    const busyButtonId = options.buttonId || "confirm-move-button";
    const busyLabel = options.label || "Processing Restow...";
    setOperationBusy(busyLabel, busyButtonId);
    try {
        const resolvedTargetSlotKey = targetSlotKey || getSlotKey(
            moveTarget.target.block,
            ["40ft", "45ft"].includes(moveTarget.movingContainer.container_type) ? getSurfaceStartBayFromWideAnchor(moveTarget.target.bay) : moveTarget.target.bay,
            moveTarget.target.row
        );
        const response = await apiFetch(`${API_BASE_URL}/restow`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                container_id: moveTarget.movingContainer.container_id,
                new_block: moveTarget.target.block,
                new_bay: moveTarget.target.bay,
                new_row: moveTarget.target.row,
                new_tier: moveTarget.nextTier,
                emergency_override: emergencyOverride,
                override_reason: moveTarget.departureRuleConflict ? overrideReason : null,
            }),
        });
        const data = await response.json();
        if (!response.ok) {
            showToast(data.detail || "Failed to move container.", "error");
            return;
        }
        state.moveDraftContainerId = null;
        state.draggingContainerId = null;
        state.dragOverSlotKey = null;
        state.pendingMove = null;
        resetMoveTargetDraft();
        applyOptimisticRestow(moveTarget.movingContainer.container_id, {
            block: moveTarget.target.block,
            bay: moveTarget.target.bay,
            row: moveTarget.target.row,
            tier: moveTarget.nextTier,
        });
        state.selectedSlotKey = resolvedTargetSlotKey;
        state.selectedContainerId = moveTarget.movingContainer.container_id;
        state.selectedBlock = moveTarget.target.block;
        ensureSlotVisible(moveTarget.target.block, moveTarget.target.bay, moveTarget.target.row);
        renderDashboard({ inventory: false, activity: false, liveStatus: false });
        refreshInventoryInBackground();
        showToast(data.message || "Container moved.", "success");
    } finally {
        setOperationBusy("", busyButtonId);
    }
}

function handleSlotDragStart(event) {
    const cell = event.target.closest(".slot-cell");
    const containerId = cell?.dataset.containerId;
    if (!containerId) {
        event.preventDefault();
        return;
    }
    state.draggingContainerId = containerId;
    state.moveDraftContainerId = containerId;
    if (event.dataTransfer) {
        event.dataTransfer.setData("text/plain", containerId);
        event.dataTransfer.effectAllowed = "move";
    }
    renderSelectionState(false);
}

function handleSlotDragEnd() {
    state.draggingContainerId = null;
    state.dragOverSlotKey = null;
    if (!state.pendingMove) state.moveDraftContainerId = null;
    renderSelectionState(false);
}

function handleSlotDragOver(event) {
    if (!state.draggingContainerId) return;
    const cell = event.target.closest(".slot-cell");
    const slotKey = resolveInteractiveSlotKey(cell, event);
    if (!slotKey) return;
    if (!canDropContainerOnSlot(state.draggingContainerId, slotKey)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    state.dragOverSlotKey = slotKey;
    cell.classList.add("is-drop-target");
}

function handleSlotDragLeave(event) {
    const cell = event.target.closest(".slot-cell");
    if (!cell) return;
    if (getCellSlotKeys(cell).includes(state.dragOverSlotKey)) {
        state.dragOverSlotKey = null;
        cell.classList.remove("is-drop-target");
    }
}

function handleSlotDrop(event) {
    if (!state.draggingContainerId) return;
    const cell = event.target.closest(".slot-cell");
    if (!cell) return;
    event.preventDefault();
    const targetSlotKey = resolveInteractiveSlotKey(cell, event);
    if (!targetSlotKey) return;
    const moveTarget = resolveMoveTarget(state.draggingContainerId, targetSlotKey);
    if (moveTarget.error) {
        showToast(moveTarget.error, "error");
        return;
    }
    state.draggingContainerId = null;
    state.dragOverSlotKey = null;
    openMoveConfirmModal(moveTarget);
}

function syncFormsFromSelection(options = {}) {
    const forceStackIn = Boolean(options.forceStackIn);
    const forceOtherForms = Boolean(options.forceOtherForms ?? options.force);
    const markStackInPositionDirty = Boolean(options.markStackInPositionDirty);
    if (state.selectedSlotKey) {
        const parsed = parseSlotKey(state.selectedSlotKey);
        const slotRecord = getSlotRecord(parsed.block, parsed.bay, parsed.row);
        const nextTier = getNextAvailableTier(getSlotContainers(parsed.block, parsed.bay, parsed.row), slotRecord.max_tiers) || slotRecord.max_tiers;
        if (forceStackIn || !state.formDirty.stackin) {
            const stackInContainerType = selectValue("in-type");
            const selectedContainer = state.selectedContainerId ? findContainerById(state.selectedContainerId) : null;
            const suggestedBay = selectedContainer && isWideContainer(selectedContainer) && ["40ft", "45ft"].includes(stackInContainerType)
                ? selectedContainer.bay
                : parsed.bay;
            setValue("in-block", parsed.block);
            setValue("in-bay", suggestedBay);
            setValue("in-row", String(parsed.row));
            setValue("in-tier", String(nextTier));
            state.stackInPositionDirty = markStackInPositionDirty;
        }
    }
    if (state.selectedContainerId) {
        if (forceOtherForms || !state.formDirty.stackout) {
            setValue("out-id", state.selectedContainerId);
        }
        if (forceOtherForms || !state.formDirty.restow) {
            setValue("restow-id", state.selectedContainerId);
        }
    }
    renderStackInAdvisory();
    renderRestowAdvisory();
}

function renderStackInBlockOptions() {
    const blockSelect = document.getElementById("in-block");
    if (!blockSelect) return;

    const currentValue = blockSelect.value;
    const blocks = getTerminalLayout().map((layout) => layout.block);
    if (!blocks.length) {
        blockSelect.innerHTML = "";
        return;
    }

    blockSelect.innerHTML = blocks.map((block) => `<option value="${block}">${block}</option>`).join("");
    const selectedBlock = state.selectedSlotKey ? parseSlotKey(state.selectedSlotKey).block : state.selectedBlock;
    const fallbackValue = blocks.includes(selectedBlock) ? selectedBlock : blocks[0];
    blockSelect.value = blocks.includes(currentValue) ? currentValue : fallbackValue;
}

function getStackInRecommendationDraft() {
    const containerType = selectValue("in-type");
    const direction = selectValue("in-direction");
    if (!containerType || !direction) return null;
    return {
        containerType,
        direction,
        bonded: selectValue("in-bonded") === "true",
        stackOutDate: optionalValue("in-stack-out-date"),
        line: optionalValue("in-line"),
        commodity: optionalValue("in-commodity"),
        weight: optionalNumberValue("in-weight"),
    };
}

function listCandidateBaysForContainerType(block, containerType) {
    if (containerType === "20ft") {
        const bays = [];
        for (let bay = 1; bay <= getMaxSurfaceBay(block); bay += 2) {
            bays.push(formatBayNumber(bay));
        }
        return bays;
    }
    if (containerType === "40ft") return listAllowedWideBays(block);
    if (containerType === "45ft") return [...new Set([formatBayNumber(2), formatBayNumber(getMaxWideBay(block))])];
    return [];
}

function getStackInCurrentPosition() {
    const block = value("in-block");
    const bay = value("in-bay");
    const row = numberValue("in-row");
    const tier = numberValue("in-tier");
    if (!block || !bay || !row || !tier) return null;
    return {
        block,
        bay: formatBayNumber(bay),
        row,
        tier,
    };
}

function isSameStackInPosition(left, right) {
    return Boolean(
        left
        && right
        && left.block === right.block
        && formatBayNumber(left.bay) === formatBayNumber(right.bay)
        && Number(left.row) === Number(right.row)
        && Number(left.tier) === Number(right.tier)
    );
}

function applyStackInSuggestedPosition(position, options = {}) {
    if (!position) return;
    setValue("in-block", position.block);
    setValue("in-bay", position.bay);
    setValue("in-row", String(position.row));
    setValue("in-tier", String(position.tier));
    state.stackInPositionDirty = Boolean(options.lockSelection);
}

function getBlockLoadRatio(block) {
    const enabledSlots = getBlockSlotRecords(block).filter((slot) => slot.enabled).length || 1;
    return getSurfaceOccupancy(block).size / enabledSlots;
}

function buildStackInSuggestionReasons({ tier, slotContainers, lineMatches, commodityMatches, blockLoadRatio, line, commodity }) {
    const reasons = [];
    if (tier === 1) {
        reasons.push("Lowest available tier");
    } else {
        reasons.push(`Supported placement at tier ${tier}`);
    }
    if (!slotContainers.length) {
        reasons.push("Free ground slot reduces reshuffles");
    }
    if (line && lineMatches > 0) {
        reasons.push(`Keeps ${line} grouped in block`);
    }
    if (commodity && commodityMatches > 0) {
        reasons.push(`Close to same commodity flow`);
    }
    if (blockLoadRatio < 0.35) {
        reasons.push("Block has healthy spare capacity");
    }
    return reasons.slice(0, 3);
}

function scoreStackInSuggestion({ block, row, bay, tier, slotContainers, draft }) {
    const normalizedLine = String(draft.line || "").trim().toLowerCase();
    const normalizedCommodity = String(draft.commodity || "").trim().toLowerCase();
    const lineMatches = normalizedLine
        ? state.inventory.filter((item) => item.block === block && String(item.line || "").trim().toLowerCase() === normalizedLine).length
        : 0;
    const commodityMatches = normalizedCommodity
        ? state.inventory.filter((item) => item.block === block && String(item.commodity || "").trim().toLowerCase() === normalizedCommodity).length
        : 0;
    const blockLoadRatio = getBlockLoadRatio(block);

    let score = 1000;
    score += tier === 1 ? 240 : Math.max(0, 220 - (tier - 1) * 70);
    score += !slotContainers.length ? 140 : Math.max(20, 80 - slotContainers.length * 18);
    score += Math.max(0, Math.round((1 - blockLoadRatio) * 60));
    score += Math.min(90, lineMatches * 18);
    score += Math.min(50, commodityMatches * 12);
    score -= parseBayNumber(bay);
    score -= Number(row) * 2;

    return {
        score,
        reasons: buildStackInSuggestionReasons({
            tier,
            slotContainers,
            lineMatches,
            commodityMatches,
            blockLoadRatio,
            line: draft.line,
            commodity: draft.commodity,
        }),
    };
}

function getStackInSuggestions(draft) {
    if (!draft) return [];

    const suggestions = [];
    getTerminalLayout().forEach((layout) => {
        const candidateBays = listCandidateBaysForContainerType(layout.block, draft.containerType);
        layout.rows.forEach((row) => {
            candidateBays.forEach((bay) => {
                for (let tier = 1; tier <= layout.tierCount; tier += 1) {
                    const placement = getStackInPlacementState({
                        block: layout.block,
                        bay,
                        row,
                        tier,
                        direction: draft.direction,
                        containerType: draft.containerType,
                        stackOutDate: draft.stackOutDate,
                    });
                    if (placement.tone !== "success") continue;
                    const surfaceBay = ["40ft", "45ft"].includes(draft.containerType)
                        ? getSurfaceStartBayFromWideAnchor(bay)
                        : bay;
                    const slotContainers = getSlotContainers(layout.block, surfaceBay, row);
                    const { score, reasons } = scoreStackInSuggestion({
                        block: layout.block,
                        row,
                        bay,
                        tier,
                        slotContainers,
                        draft,
                    });
                    suggestions.push({
                        block: layout.block,
                        bay,
                        row,
                        tier,
                        score,
                        reasons,
                    });
                    break;
                }
            });
        });
    });

    return suggestions
        .sort((left, right) => (
            right.score - left.score
            || left.block.localeCompare(right.block)
            || parseBayNumber(left.bay) - parseBayNumber(right.bay)
            || left.row - right.row
            || left.tier - right.tier
        ))
        .slice(0, 3);
}

function renderStackInSuggestions(suggestions, autoApplied = false) {
    const panel = document.getElementById("stackin-suggestions-panel");
    const summary = document.getElementById("stackin-suggestions-summary");
    const list = document.getElementById("stackin-suggestions-list");
    if (!panel || !summary || !list) return;

    const draft = getStackInRecommendationDraft();
    if (!draft) {
        panel.classList.add("hidden");
        return;
    }

    panel.classList.remove("hidden");
    const currentPosition = getStackInCurrentPosition();
    if (!suggestions.length) {
        summary.textContent = "No safe slot suggestion is available for the current yard state.";
        list.innerHTML = `<div class="suggestion-empty">Try a different type, direction, or release a safer slot first.</div>`;
        return;
    }

    summary.textContent = autoApplied
        ? `Best safe slot auto-filled. ${suggestions.length} recommendation${suggestions.length === 1 ? "" : "s"} available.`
        : `${suggestions.length} safe recommendation${suggestions.length === 1 ? "" : "s"} available.`;

    list.innerHTML = suggestions.map((suggestion, index) => {
        const isSelected = isSameStackInPosition(currentPosition, suggestion);
        const badge = index === 0 ? "Best" : `Alt ${index}`;
        const reasonText = suggestion.reasons.length ? suggestion.reasons.join(" · ") : "Safe current-yard placement";
        return `
            <div class="suggestion-card ${index === 0 ? "is-best" : ""} ${isSelected ? "is-selected" : ""}">
                <div class="suggestion-card-main">
                    <div class="suggestion-card-top">
                        <span class="slot-badge neutral ${index === 0 ? "suggestion-rank-best" : ""}">${badge}</span>
                        <strong>${suggestion.block}-${suggestion.bay}-${suggestion.row}-${suggestion.tier}</strong>
                    </div>
                    <small>${reasonText}</small>
                </div>
                <button type="button" class="btn-secondary suggestion-apply-btn" data-stackin-suggestion-index="${index}">
                    ${isSelected ? "Selected" : "Use"}
                </button>
            </div>
        `;
    }).join("");

    list.querySelectorAll("[data-stackin-suggestion-index]").forEach((button) => button.addEventListener("click", () => {
        const suggestion = suggestions[Number(button.dataset.stackinSuggestionIndex)];
        if (!suggestion) return;
        applyStackInSuggestedPosition(suggestion, { lockSelection: true });
        renderStackInAdvisory();
    }));
}

function renderViewportControls(layout, visibleRows, visibleBays) {
    const totalRowPages = Math.max(1, Math.ceil(layout.rows.length / state.viewportSize));
    const totalBayPages = Math.max(1, Math.ceil(layout.bays.length / state.viewportSize));
    setText("rows-range", `${visibleRows[0]}-${visibleRows[visibleRows.length - 1]}`);
    setText("bays-range", `${visibleBays[0]}-${visibleBays[visibleBays.length - 1]}`);
    setText("viewport-summary-text", `Rows page ${state.rowPage + 1}/${totalRowPages} · Bays page ${state.bayPage + 1}/${totalBayPages} · ${layout.tierCount} tiers standard`);
    document.getElementById("rows-prev").disabled = state.rowPage === 0;
    document.getElementById("rows-next").disabled = state.rowPage >= totalRowPages - 1;
    document.getElementById("bays-prev").disabled = state.bayPage === 0;
    document.getElementById("bays-next").disabled = state.bayPage >= totalBayPages - 1;
    document.getElementById("jump-bay").max = String(getMaxSurfaceBay(layout.block));
    document.getElementById("jump-row").max = String(layout.rows.length);
}

function updateLiveStatus() {
    if (!state.lastLoadedAt || !state.currentUser) {
        setText("live-status", "offline");
        return;
    }
    setText("live-status", `online · ${state.lastLoadedAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} · auto`);
}

function clampViewport() {
    const layout = getBlockLayout(state.selectedBlock);
    state.rowPage = Math.min(state.rowPage, Math.max(0, Math.ceil(layout.rows.length / state.viewportSize) - 1));
    state.bayPage = Math.min(state.bayPage, Math.max(0, Math.ceil(layout.bays.length / state.viewportSize) - 1));
}

function getVisibleRows(layout) {
    const start = state.rowPage * state.viewportSize;
    return layout.rows.slice(start, start + state.viewportSize);
}

function getVisibleBays(layout) {
    const start = state.bayPage * state.viewportSize;
    return layout.bays.slice(start, start + state.viewportSize);
}

function ensureSlotVisible(block, bay, row) {
    const layout = getBlockLayout(block);
    const rowIndex = layout.rows.indexOf(Number(row));
    const surfaceBay = isSurfaceBay(bay) ? formatBayNumber(bay) : getSurfaceStartBayFromWideAnchor(bay);
    const bayIndex = layout.bays.indexOf(String(surfaceBay));
    if (rowIndex >= 0) state.rowPage = Math.floor(rowIndex / state.viewportSize);
    if (bayIndex >= 0) state.bayPage = Math.floor(bayIndex / state.viewportSize);
}

function jumpToSlot() {
    const layout = getBlockLayout(state.selectedBlock);
    const bayValue = Number(document.getElementById("jump-bay").value);
    const rowValue = Number(document.getElementById("jump-row").value);
    if (!bayValue || !rowValue) {
        showToast("Enter both bay and row.", "error");
        return;
    }
    if (bayValue < 1 || bayValue > getMaxSurfaceBay(layout.block) || rowValue < 1 || rowValue > layout.rows.length) {
        showToast(`Target is outside block ${layout.block}.`, "error");
        return;
    }
    const bay = formatBayNumber(bayValue);
    const surfaceBay = isSurfaceBay(bay) ? bay : getSurfaceStartBayFromWideAnchor(bay);
    const row = rowValue;
    const slotKey = getSlotKey(layout.block, surfaceBay, row);
    const previousBlock = state.selectedBlock;
    state.selectedSlotKey = slotKey;
    state.selectedContainerId = getVisibleContainerForSlot(getSlotContainers(layout.block, surfaceBay, row))?.container_id || null;
    ensureSlotVisible(layout.block, bay, row);
    if (state.selectedContainerId) ensureContainerHistory(state.selectedContainerId);
    syncFormsFromSelection({ forceStackIn: true, markStackInPositionDirty: true });
    renderSelectionState(previousBlock !== state.selectedBlock);
    showToast(`Jumped to ${layout.block}-${bay}-${row}.`, "success");
}

function getBlockContainers(block) {
    return state.blockContainersIndex.get(block) || [];
}

function getSlotContainers(block, bay, row) {
    return state.slotContainersIndex.get(getSlotKey(block, bay, row)) || [];
}

function getSelectedContainer(slotContainers) {
    return slotContainers.find((container) => container.container_id === state.selectedContainerId) || getVisibleContainerForSlot(slotContainers) || getTopContainer(slotContainers) || null;
}

function getVisibleContainerForSlot(slotContainers) {
    if (!slotContainers.length) return null;
    if (state.tierVisibility === "top") return slotContainers[slotContainers.length - 1];
    return slotContainers.find((container) => String(container.tier_num) === state.tierVisibility) || null;
}

function getTopContainer(slotContainers) {
    return slotContainers[slotContainers.length - 1] || null;
}

function getNextAvailableTier(slotContainers, tierCount) {
    const used = new Set(slotContainers.map((container) => container.tier_num));
    for (let tier = 1; tier <= tierCount; tier += 1) {
        if (!used.has(tier)) return tier;
    }
    return null;
}

function findContainerById(containerId) {
    return state.containerById.get(containerId) || null;
}

function getSlotKey(block, bay, row) {
    return `${block}-${bay}-${row}`;
}

function parseSlotKey(slotKey) {
    const [block, bay, row] = slotKey.split("-");
    return { block, bay, row: Number(row) };
}

function getCellSlotKeys(cell) {
    if (!cell) return [];
    return [cell.dataset.slotKey, cell.dataset.altSlotKey].filter(Boolean);
}

function resolveInteractiveSlotKey(cell, event) {
    const slotKeys = getCellSlotKeys(cell);
    if (!slotKeys.length) return null;
    if (slotKeys.length === 1) return slotKeys[0];
    const rect = cell.getBoundingClientRect();
    if (!rect.width) return slotKeys[0];
    const pointerX = typeof event?.clientX === "number" ? event.clientX : rect.left + rect.width / 2;
    return pointerX >= rect.left + rect.width / 2 ? slotKeys[1] : slotKeys[0];
}

function humanizeOperation(operationType) {
    return {
        STACK_IN: "Stack In",
        STACK_OUT: "Stack Out",
        RESTOW: "Restow",
    }[operationType] || operationType;
}

function getBayDirectionConflict({ block, bay, direction, containerType, excludeContainerId = null }) {
    const targetSurfaceBays = new Set(getSurfaceBaysForPlacement(block, bay, containerType));
    const normalizedDirection = String(direction || "").trim().toLowerCase();
    return state.inventory.find((item) => (
        item.block === block
        && getSurfaceBaysForPlacement(item.block, item.bay, item.container_type).some((surfaceBay) => targetSurfaceBays.has(surfaceBay))
        && item.container_id !== excludeContainerId
        && String(item.direction || "").trim().toLowerCase() !== normalizedDirection
    )) || null;
}

function parsePriorityDate(value) {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    const raw = String(value).trim();
    if (!raw) return null;
    const normalized = raw.length <= 10 ? `${raw}T00:00:00Z` : raw;
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getPriorityReference(stackOutDate, arrivedAt) {
    const plannedDate = parsePriorityDate(stackOutDate);
    if (plannedDate) {
        return {
            date: plannedDate,
            source: "stack out",
            label: formatShortDate(stackOutDate),
        };
    }
    const arrivalDate = parsePriorityDate(arrivedAt);
    if (arrivalDate) {
        return {
            date: arrivalDate,
            source: "arrival",
            label: formatShortDate(arrivedAt),
        };
    }
    return { date: null, source: "arrival", label: "not set" };
}

function buildDeparturePriorityMessage(conflict) {
    return `${conflict.item.container_id} is scheduled by ${conflict.priority.source} date ${conflict.priority.label}, which is earlier than this container's ${conflict.candidatePriority.source} date ${conflict.candidatePriority.label}.`;
}

function getDeparturePriorityConflict({
    block,
    bay,
    row,
    tier,
    containerType,
    stackOutDate,
    arrivedAt,
    excludeContainerId = null,
}) {
    if (!block || !bay || !row || !tier || Number(tier) <= 1 || !containerType) return null;
    const candidatePriority = getPriorityReference(stackOutDate, arrivedAt || new Date().toISOString());
    if (!candidatePriority.date) return null;
    const targetSlots = new Set(getSurfaceSlotKeys(block, bay, row, containerType));
    const conflicts = state.inventory
        .filter((item) => {
            if (item.container_id === excludeContainerId) return false;
            if (item.block !== block || Number(item.row_num) !== Number(row) || Number(item.tier_num) >= Number(tier)) return false;
            const occupiedSlots = new Set(getSurfaceSlotKeys(item.block, item.bay, item.row_num, item.container_type));
            return [...occupiedSlots].some((slotKey) => targetSlots.has(slotKey));
        })
        .map((item) => ({ item, priority: getPriorityReference(item.stack_out_date, item.arrived_at) }))
        .filter(({ priority }) => priority.date && priority.date < candidatePriority.date)
        .sort((left, right) => left.priority.date - right.priority.date);
    if (!conflicts.length) return null;
    const lead = conflicts[0];
    return {
        item: lead.item,
        priority: lead.priority,
        candidatePriority,
        message: buildDeparturePriorityMessage({ item: lead.item, priority: lead.priority, candidatePriority }),
    };
}

function getDeparturePriorityWarning(options) {
    return getDeparturePriorityConflict(options)?.message || null;
}

function getExactBlockLayout(block) {
    return getTerminalLayout().find((item) => item.block === String(block).trim()) || null;
}

function get45ftAllowedBayLabel(block) {
    const allowed = [...new Set([formatBayNumber(2), formatBayNumber(getMaxWideBay(block))])];
    return allowed.join(" or ");
}

function getStackInDraft() {
    const block = value("in-block");
    const bay = value("in-bay");
    const row = numberValue("in-row");
    const tier = numberValue("in-tier");
    const direction = selectValue("in-direction");
    const containerType = selectValue("in-type");
    if (!block || !bay || !row || !tier || !direction || !containerType) return null;
    return {
        block,
        bay,
        row,
        tier,
        direction,
        containerType,
        stackOutDate: optionalValue("in-stack-out-date"),
    };
}

function getStackInPlacementState(draft) {
    const normalizedBlock = String(draft.block || "").trim();
    const rawBay = String(draft.bay || "").trim();
    const tier = Number(draft.tier);
    const row = Number(draft.row);
    const containerType = draft.containerType;
    const direction = draft.direction;

    if (!/^\d{2,3}$/.test(normalizedBlock)) {
        return { tone: "error", message: "Block must contain exactly 2 digits, or 3 digits in exceptional cases." };
    }
    if (!/^\d{2,3}$/.test(rawBay)) {
        return { tone: "error", message: "Bay must contain exactly 2 digits, or 3 digits in exceptional cases." };
    }

    const layout = getExactBlockLayout(normalizedBlock);
    if (!layout) {
        return { tone: "error", message: `Block ${normalizedBlock} is not available in the current terminal layout.` };
    }

    const normalizedBay = formatBayNumber(rawBay);
    if (row < 1 || row > layout.rowCount) {
        return { tone: "error", message: `Row must be between 1 and ${layout.rowCount} for block ${layout.block}.` };
    }
    if (tier < 1 || tier > layout.tierCount) {
        return { tone: "error", message: `Tier must be between 1 and ${layout.tierCount} for block ${layout.block}.` };
    }

    const bayNumber = parseBayNumber(normalizedBay);
    if (bayNumber < 1 || bayNumber > getMaxSurfaceBay(layout.block)) {
        return { tone: "error", message: `Bay must be between 01 and ${formatBayNumber(getMaxSurfaceBay(layout.block))} for block ${layout.block}.` };
    }

    if (containerType === "20ft" && !isSurfaceBay(normalizedBay)) {
        return { tone: "error", message: "Rule violation: 20ft containers cannot be placed in even bays." };
    }
    if (["40ft", "45ft"].includes(containerType) && isSurfaceBay(normalizedBay)) {
        return { tone: "error", message: `Rule violation: ${containerType} containers cannot be placed in odd bays.` };
    }

    if (containerType === "45ft" && !is45ftAnchorAllowed(layout.block, normalizedBay)) {
        return {
            tone: "error",
            message: `45ft containers can use only bays ${get45ftAllowedBayLabel(layout.block)} in block ${layout.block}.`,
        };
    }

    const slotLookupBay = ["40ft", "45ft"].includes(containerType)
        ? getSurfaceStartBayFromWideAnchor(normalizedBay)
        : normalizedBay;

    if (["40ft", "45ft"].includes(containerType) && !canStartWideAtSurfaceBay(layout.block, slotLookupBay)) {
        return {
            tone: "error",
            message: `${containerType} containers cannot start at bay ${slotLookupBay} in block ${layout.block}.`,
        };
    }

    const slotRecord = getSlotRecord(layout.block, slotLookupBay, row);
    if (!slotRecord.enabled) {
        return { tone: "error", message: `Slot ${slotRecord.slot_code} is blocked in the slot directory.` };
    }
    if (!slotRecord.allowed_container_types.includes(containerType)) {
        return { tone: "error", message: `Slot ${slotRecord.slot_code} does not allow container type ${containerType}.` };
    }
    if (tier > Number(slotRecord.max_tiers || layout.tierCount)) {
        return { tone: "error", message: `Slot ${slotRecord.slot_code} supports tiers only up to ${slotRecord.max_tiers}.` };
    }
    if (!hasSupportingBase(layout.block, normalizedBay, row, tier, containerType)) {
        return { tone: "error", message: `${containerType} is not supported by the lower tier at ${layout.block}-${normalizedBay}-${row}-${tier}.` };
    }

    const occupant = findPositionOccupant(layout.block, normalizedBay, row, tier, containerType);
    if (occupant) {
        return {
            tone: "error",
            message: `Position ${layout.block}-${normalizedBay}-${row}-${tier} is already occupied by container ${occupant.container_id}.`,
        };
    }

    const directionConflict = getBayDirectionConflict({
        block: layout.block,
        bay: normalizedBay,
        direction,
        containerType,
    });
    if (directionConflict) {
        return {
            tone: "error",
            message: `Bay ${layout.block}-${normalizedBay} already contains ${directionConflict.direction} container ${directionConflict.container_id}. Import and Export cannot be mixed in one bay.`,
        };
    }

    const departureRuleConflict = getDeparturePriorityConflict({
        block: layout.block,
        bay: normalizedBay,
        row,
        tier,
        containerType,
        stackOutDate: draft.stackOutDate,
        arrivedAt: new Date().toISOString(),
    });
    const overrideEligible = Boolean(departureRuleConflict && canUseEmergencyDepartureOverride());
    const overrideChecked = overrideEligible && checked("stackin-emergency-override");
    const overrideReason = overrideChecked ? optionalValue("stackin-override-reason") : null;

    if (departureRuleConflict && !overrideEligible) {
        return {
            tone: "error",
            message: `Stacking order blocked: ${departureRuleConflict.message}`,
            requiresOverride: false,
            overrideEligible: false,
            overrideChecked: false,
            overrideReason: null,
            departureRuleConflict,
        };
    }
    if (departureRuleConflict) {
        if (!overrideChecked) {
            return {
                tone: "warning",
                message: `Stacking order blocked: ${departureRuleConflict.message} Enable Emergency Override to continue.`,
                requiresOverride: true,
                overrideEligible: true,
                overrideChecked,
                overrideReason,
                departureRuleConflict,
            };
        }
        if (!overrideReason) {
            return {
                tone: "warning",
                message: "Emergency override selected. Enter a reason to continue with this placement.",
                requiresOverride: true,
                overrideEligible: true,
                overrideChecked,
                overrideReason,
                departureRuleConflict,
            };
        }
        return {
            tone: "warning",
            message: `Emergency override ready: ${departureRuleConflict.message}`,
            requiresOverride: true,
            overrideEligible: true,
            overrideChecked,
            overrideReason,
            departureRuleConflict,
        };
    }

    return {
        tone: "success",
        message: `Placement looks good: ${layout.block}-${normalizedBay}-${row}-${tier} is valid for ${containerType} and matches the current yard rules.`,
        requiresOverride: false,
        overrideEligible: false,
        overrideChecked: false,
        overrideReason: null,
        departureRuleConflict: null,
    };
}

function getStackInAdvisory() {
    const draft = getStackInDraft();
    if (!draft) {
        return {
            tone: "neutral",
            message: "Placement rules and stacking hints will appear here.",
        };
    }
    return getStackInPlacementState(draft);
}

function renderStackInAdvisory() {
    const advisory = document.getElementById("stackin-advisory");
    const positionGroup = document.getElementById("stackin-position-group");
    if (!advisory) return;
    let suggestions = getStackInSuggestions(getStackInRecommendationDraft());
    let autoApplied = false;
    if (!state.stackInPositionDirty && suggestions.length && !isSameStackInPosition(getStackInCurrentPosition(), suggestions[0])) {
        applyStackInSuggestedPosition(suggestions[0]);
        autoApplied = true;
        suggestions = getStackInSuggestions(getStackInRecommendationDraft());
    }
    const next = getStackInAdvisory();
    advisory.textContent = next.message;
    advisory.classList.remove("neutral", "warning", "error", "success");
    advisory.classList.add(next.tone);
    if (positionGroup) {
        positionGroup.classList.remove("is-valid", "is-warning", "is-error");
        if (next.tone === "success") positionGroup.classList.add("is-valid");
        if (next.tone === "warning") positionGroup.classList.add("is-warning");
        if (next.tone === "error") positionGroup.classList.add("is-error");
    }
    syncOverridePanel("stackin", {
        visible: Boolean(next.overrideEligible),
        conflictMessage: next.departureRuleConflict ? `${next.departureRuleConflict.message} Enable emergency override to continue.` : "",
        readyMessage: next.departureRuleConflict ? `Emergency override will be logged against lower container ${next.departureRuleConflict.item.container_id}.` : "",
    });
    renderStackInSuggestions(suggestions, autoApplied);
}

function resolveRestowFormMove() {
    const containerId = value("restow-id");
    const block = value("restow-block");
    const bayValue = value("restow-bay");
    const row = numberValue("restow-row");
    const tier = numberValue("restow-tier");
    if (!containerId || !block || !bayValue || !row || !tier) {
        return { incomplete: true };
    }
    const movingContainer = findContainerById(containerId);
    if (!movingContainer) {
        return { error: `Container ${containerId} is not in inventory.` };
    }
    const normalizedBay = formatBayNumber(bayValue);
    if (isWideContainer(movingContainer) && isSurfaceBay(normalizedBay)) {
        return { error: `${movingContainer.container_type} containers must use even bays like 02, 06 or 26.` };
    }
    const surfaceBay = isWideContainer(movingContainer) ? getSurfaceStartBayFromWideAnchor(normalizedBay) : normalizedBay;
    return { moveTarget: resolveMoveTarget(movingContainer.container_id, getSlotKey(block, surfaceBay, row)) };
}

function getRestowAdvisory() {
    const advisory = document.getElementById("restow-advisory");
    if (!advisory) {
        return {
            tone: "neutral",
            message: "Move rules and stacking checks will appear here.",
            requiresOverride: false,
            overrideEligible: false,
            overrideChecked: false,
            overrideReason: null,
            departureRuleConflict: null,
        };
    }
    const resolution = resolveRestowFormMove();
    if (resolution.incomplete) {
        return {
            tone: "neutral",
            message: "Move rules and stacking checks will appear here.",
            requiresOverride: false,
            overrideEligible: false,
            overrideChecked: false,
            overrideReason: null,
            departureRuleConflict: null,
        };
    }
    if (resolution.error || resolution.moveTarget?.error) {
        return {
            tone: "error",
            message: resolution.error || resolution.moveTarget.error,
            requiresOverride: false,
            overrideEligible: false,
            overrideChecked: false,
            overrideReason: null,
            departureRuleConflict: null,
        };
    }
    const moveTarget = resolution.moveTarget;
    const overrideChecked = Boolean(moveTarget.departureRuleConflict && checked("restow-emergency-override"));
    const overrideReason = overrideChecked ? optionalValue("restow-override-reason") : null;
    if (!moveTarget.departureRuleConflict) {
        return {
            tone: "neutral",
            message: `Move looks good: target ${moveTarget.target.block}-${moveTarget.target.bay}-${moveTarget.target.row}-${moveTarget.nextTier} respects current stacking order.`,
            requiresOverride: false,
            overrideEligible: false,
            overrideChecked: false,
            overrideReason: null,
            departureRuleConflict: null,
        };
    }
    if (!overrideChecked) {
        return {
            tone: "warning",
            message: `Stacking order blocked: ${moveTarget.departureRuleConflict.message} Enable Emergency Override to continue.`,
            requiresOverride: true,
            overrideEligible: true,
            overrideChecked,
            overrideReason,
            departureRuleConflict: moveTarget.departureRuleConflict,
        };
    }
    if (!overrideReason) {
        return {
            tone: "warning",
            message: "Emergency override selected. Enter a reason to continue with this move.",
            requiresOverride: true,
            overrideEligible: true,
            overrideChecked,
            overrideReason,
            departureRuleConflict: moveTarget.departureRuleConflict,
        };
    }
    return {
        tone: "warning",
        message: `Emergency override ready: ${moveTarget.departureRuleConflict.message}`,
        requiresOverride: true,
        overrideEligible: true,
        overrideChecked,
        overrideReason,
        departureRuleConflict: moveTarget.departureRuleConflict,
    };
}

function renderRestowAdvisory() {
    const advisoryEl = document.getElementById("restow-advisory");
    if (!advisoryEl) return;
    const advisory = getRestowAdvisory();
    advisoryEl.textContent = advisory.message;
    advisoryEl.classList.remove("neutral", "warning", "error");
    advisoryEl.classList.add(advisory.tone);
    syncOverridePanel("restow", {
        visible: Boolean(advisory.overrideEligible),
        conflictMessage: advisory.departureRuleConflict ? `${advisory.departureRuleConflict.message} Enable emergency override to continue.` : "",
        readyMessage: advisory.departureRuleConflict ? `Emergency override will be logged against lower container ${advisory.departureRuleConflict.item.container_id}.` : "",
    });
}

function formatDate(value) {
    return new Date(value).toISOString().slice(0, 10);
}

function getLocalDateKey(value = new Date()) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function formatDateTime(value) {
    return new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    }).format(new Date(value));
}

function formatShortDate(value) {
    if (!value) return "";
    const parsed = parsePriorityDate(value);
    if (!parsed) return "";
    return parsed.toISOString().slice(0, 10);
}

function formatWeight(value) {
    if (value == null || value === "") return "";
    const numeric = Number(value);
    if (Number.isNaN(numeric)) return String(value);
    return `${numeric.toLocaleString("en-US", { maximumFractionDigits: 3 })} kg`;
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function on(id, event, handler) {
    document.getElementById(id).addEventListener(event, handler);
}

function value(id) {
    return document.getElementById(id).value.trim();
}

function optionalValue(id) {
    const raw = value(id);
    return raw || null;
}

function numberValue(id) {
    return Number(document.getElementById(id).value);
}

function optionalNumberValue(id) {
    const raw = value(id);
    if (!raw) return null;
    const numeric = Number(raw);
    return Number.isNaN(numeric) ? null : numeric;
}

function selectValue(id) {
    return document.getElementById(id).value;
}

function checked(id) {
    return document.getElementById(id).checked;
}

function setValue(id, val) {
    document.getElementById(id).value = val;
}

function setText(id, text) {
    document.getElementById(id).textContent = text;
}

function setChecked(id, val) {
    document.getElementById(id).checked = val;
}

function showToast(message, tone = "success") {
    const toast = document.getElementById("toast");
    if (!toast || !message) return;
    if (state.toastTimer) window.clearTimeout(state.toastTimer);
    toast.textContent = message;
    toast.classList.remove("hidden", "show", "success", "error");
    toast.classList.add(tone === "error" ? "error" : "success");
    window.requestAnimationFrame(() => {
        toast.classList.add("show");
    });
    state.toastTimer = window.setTimeout(() => {
        toast.classList.remove("show");
        window.setTimeout(() => toast.classList.add("hidden"), 250);
        state.toastTimer = null;
    }, 2600);
}
