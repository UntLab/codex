const IS_LOCAL = ["127.0.0.1", "localhost"].includes(window.location.hostname);
const API_ORIGIN = IS_LOCAL ? "http://127.0.0.1:8000" : window.location.origin;
const API_BASE_URL = `${API_ORIGIN}/api/containers`;
const API_ROOT = `${API_ORIGIN}/api`;
const STORAGE_TOKEN_KEY = "bitvantage_auth_token";
const STORAGE_USER_KEY = "bitvantage_user";
const AUTO_REFRESH_MS = 15000;
const MAX_TIER_COUNT = 4;
const DEFAULT_VIEWPORT_SIZE = 14;

const DEFAULT_LAYOUT = [
    { block: "01", bayCount: 10, rowCount: 2, tierCount: MAX_TIER_COUNT, label: "West Rail Block", equipment: "Left of the railway", footprint: "10 x 2" },
    { block: "02", bayCount: 14, rowCount: 3, tierCount: MAX_TIER_COUNT, label: "East Rail Block", equipment: "Right of the railway", footprint: "14 x 3" },
];

const state = {
    authToken: null,
    currentUser: null,
    layoutConfig: [],
    slotCatalog: [],
    inventory: [],
    logs: [],
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
    formDirty: {
        stackin: false,
        stackout: false,
        restow: false,
    },
};

document.addEventListener("DOMContentLoaded", async () => {
    setupTabs();
    setupForms();
    setupDashboardActions();
    setupAuth();
    setupSettings();
    setupMoveConfirmation();
    setupAdmin();
    restoreLocalSession();

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
}

function setupForms() {
    bindFormDirtyTracking("stackin-form", "stackin");
    bindFormDirtyTracking("stackout-form", "stackout");
    bindFormDirtyTracking("restow-form", "restow");

    document.getElementById("stackin-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        await submitForm(event.target, `${API_BASE_URL}/stack-in`, {
            container_id: value("in-id"),
            container_type: selectValue("in-type"),
            status: selectValue("in-status"),
            direction: selectValue("in-direction"),
            block: value("in-block"),
            bay: value("in-bay"),
            row: numberValue("in-row"),
            tier: numberValue("in-tier"),
        });
    });

    document.getElementById("stackout-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        await submitForm(event.target, `${API_BASE_URL}/stack-out`, {
            container_id: value("out-id"),
        });
    });

    document.getElementById("restow-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        await submitForm(event.target, `${API_BASE_URL}/restow`, {
            container_id: value("restow-id"),
            new_block: value("restow-block"),
            new_bay: value("restow-bay"),
            new_row: numberValue("restow-row"),
            new_tier: numberValue("restow-tier"),
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
    on("tier-visibility", "change", (event) => {
        state.tierVisibility = event.target.value;
        renderDashboard();
    });
    on("viewport-size", "change", (event) => {
        state.viewportSize = Number(event.target.value);
        state.rowPage = 0;
        state.bayPage = 0;
        renderDashboard();
    });
    on("rows-prev", "click", () => {
        state.rowPage = Math.max(0, state.rowPage - 1);
        renderDashboard();
    });
    on("rows-next", "click", () => {
        state.rowPage += 1;
        renderDashboard();
    });
    on("bays-prev", "click", () => {
        state.bayPage = Math.max(0, state.bayPage - 1);
        renderDashboard();
    });
    on("bays-next", "click", () => {
        state.bayPage += 1;
        renderDashboard();
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
            renderInspector();
            showToast("Move mode cancelled.", "success");
            return;
        }
        if (!state.selectedContainerId) {
            showToast("Select a container on the map first.", "error");
            return;
        }
        state.moveDraftContainerId = state.selectedContainerId;
        renderInspector();
        showToast("Pick a target slot on the map to prefill Restow.", "success");
        openTab("dashboard-tab");
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
    on("confirm-move-button", "click", async () => {
        if (!state.pendingMove) return;
        const pending = state.pendingMove;
        closeMoveConfirmModal();
        await executeRestowMove(pending);
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
        await loadInventory();
        return true;
    } catch {
        resetSessionState();
        return false;
    }
}

async function login(username, password) {
    setAuthError();
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
        await loadInventory();
        showToast(`Signed in as ${state.currentUser.full_name}.`, "success");
    } catch (error) {
        setAuthError(error.message);
    }
}

async function logout() {
    try {
        if (state.authToken) await apiFetch(`${API_ROOT}/auth/logout`, { method: "POST" }, true);
    } catch {}
    resetSessionState();
    showAuthScreen();
    showToast("Signed out.", "success");
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
    state.slotCatalog = [];
    state.inventory = [];
    state.logs = [];
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
    syncSessionBadge();
    syncRoleBasedUi();
    renderDashboard();
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
    const canOpenAdmin = Boolean(state.currentUser && state.currentUser.role === "ADMIN");
    adminNavItem.classList.toggle("hidden", !canOpenAdmin);
    if (!canOpenAdmin && document.getElementById("admin-tab").classList.contains("active")) {
        openTab("dashboard-tab");
    }
}

function openMoveConfirmModal(moveTarget) {
    state.pendingMove = moveTarget;
    setText("move-confirm-container", moveTarget.movingContainer.container_id);
    setText("move-confirm-type", `${moveTarget.movingContainer.container_type} · ${moveTarget.movingContainer.status} · ${moveTarget.movingContainer.direction}`);
    setText("move-confirm-route", `${moveTarget.movingContainer.position_code} -> ${moveTarget.target.block}-${moveTarget.target.bay}-${moveTarget.target.row}-${moveTarget.nextTier}`);
    setText("move-confirm-tier", `Target tier ${moveTarget.nextTier} of ${moveTarget.slotRecord.max_tiers}`);
    document.getElementById("move-confirm-rules").innerHTML = `
        <div class="history-item"><strong>Allowed types</strong><span>${moveTarget.slotRecord.allowed_container_types.join(", ")}</span><small>${moveTarget.slotRecord.notes || "No slot note"}</small></div>
        <div class="history-item"><strong>Slot status</strong><span>${moveTarget.slotRecord.enabled ? "Open" : "Blocked"}</span><small>${moveTarget.target.block}-${moveTarget.target.bay}-${moveTarget.target.row}</small></div>
    `;
    document.getElementById("move-confirm-modal").classList.remove("hidden");
}

function closeMoveConfirmModal() {
    document.getElementById("move-confirm-modal").classList.add("hidden");
    state.pendingMove = null;
    state.draggingContainerId = null;
    state.dragOverSlotKey = null;
    state.moveDraftContainerId = null;
    renderDashboard();
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

async function loadInventory(options = {}) {
    if (!state.authToken) return;
    try {
        const [layoutResponse, slotsResponse, inventoryResponse, logsResponse] = await Promise.all([
            apiFetch(`${API_ROOT}/yard/layout`),
            apiFetch(`${API_ROOT}/yard/slots`),
            apiFetch(`${API_BASE_URL}/inventory`),
            apiFetch(`${API_BASE_URL}/logs?limit=200`),
        ]);
        state.layoutConfig = layoutResponse.ok ? await layoutResponse.json() : [];
        state.slotCatalog = slotsResponse.ok ? await slotsResponse.json() : [];
        if (!inventoryResponse.ok) throw new Error("Failed to fetch inventory.");
        state.inventory = (await inventoryResponse.json()).map((item) => ({ ...item, row_num: Number(item.row_num), tier_num: Number(item.tier_num) }));
        state.logs = logsResponse.ok ? await logsResponse.json() : [];
        state.lastLoadedAt = new Date();
        preserveSelection();
        if (state.currentUser?.permissions?.includes("manage_users")) await loadAdminUsers();
        if (state.currentUser?.permissions?.includes("manage_layout")) {
            renderAdminBlocks();
            renderAdminSlots();
        }
        renderDashboard();
    } catch (error) {
        if (!options.silent) showToast(error.message, "error");
    }
}

async function submitForm(form, url, payload) {
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
    if (form.id === "stackout-form") state.formDirty.stackout = false;
    if (form.id === "restow-form") state.formDirty.restow = false;
    if (typeof form.reset === "function") form.reset();
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
    showToast(data.message || "Operation completed.", "success");
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
    const base = (state.layoutConfig.length ? state.layoutConfig : DEFAULT_LAYOUT).map((layout) => ({
        block: layout.block,
        label: layout.label || `Block ${layout.block}`,
        bayCount: layout.bay_count || layout.bayCount,
        rowCount: layout.row_count || layout.rowCount,
        tierCount: layout.tier_count || layout.tierCount,
        equipment: layout.equipment || null,
        footprint: layout.footprint || `${layout.bay_count || layout.bayCount} x ${layout.row_count || layout.rowCount}`,
    }));
    return base.map((layout) => ({
        ...layout,
        bays: Array.from({ length: layout.bayCount }, (_, index) => formatBayNumber(index * 2 + 1)),
        rows: Array.from({ length: layout.rowCount }, (_, index) => index + 1),
    }));
}

function getBlockLayout(block) {
    return getTerminalLayout().find((item) => item.block === block) || getTerminalLayout()[0];
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
    const occupied = new Set();
    getBlockContainers(block).forEach((container) => {
        getSurfaceBaysForPlacement(container.block, container.bay, container.container_type).forEach((surfaceBay) => {
            occupied.add(getSlotKey(container.block, surfaceBay, container.row_num));
        });
    });
    return occupied;
}

function getAnchoredWideContainer(block, bay, row) {
    if (!canStartWideAtSurfaceBay(block, bay)) return null;
    const anchorBay = getWideAnchorBayFromSurfaceBay(bay);
    const anchorContainer = getVisibleContainerForSlot(
        state.inventory
            .filter((container) => container.block === block && container.bay === anchorBay && Number(container.row_num) === Number(row))
            .sort((a, b) => a.tier_num - b.tier_num)
    );
    return canContainerSpanHorizontal(anchorContainer) ? anchorContainer : null;
}

function getCoveringWideContainer(block, bay, row) {
    const bayNum = parseBayNumber(bay);
    if (bayNum % 4 !== 3) return null;
    const anchorBay = formatBayNumber(bayNum - 1);
    const anchorContainer = getVisibleContainerForSlot(
        state.inventory
            .filter((container) => container.block === block && container.bay === anchorBay && Number(container.row_num) === Number(row))
            .sort((a, b) => a.tier_num - b.tier_num)
    );
    return canContainerSpanHorizontal(anchorContainer) ? anchorContainer : null;
}

function getSurfacePositionCodes(block, bay, row, tier, containerType) {
    return getSurfaceBaysForPlacement(block, bay, containerType).map((surfaceBay) => `${block}-${surfaceBay}-${row}-${tier}`);
}

function findPositionOccupant(block, bay, row, tier, containerType, excludeContainerId = null) {
    const targetCodes = new Set(getSurfacePositionCodes(block, bay, row, tier, containerType));
    return state.inventory.find((container) => {
        if (excludeContainerId && container.container_id === excludeContainerId) return false;
        return getSurfacePositionCodes(container.block, container.bay, container.row_num, container.tier_num, container.container_type)
            .some((code) => targetCodes.has(code));
    }) || null;
}

function hasSupportingBase(block, bay, row, tier, containerType) {
    if (tier <= 1) return true;
    const supportCodes = new Set(getSurfacePositionCodes(block, bay, row, tier - 1, containerType));
    return [...supportCodes].every((targetCode) =>
        state.inventory.some((container) =>
            container.block === block &&
            Number(container.row_num) === Number(row) &&
            Number(container.tier_num) === tier - 1 &&
            getSurfacePositionCodes(container.block, container.bay, container.row_num, container.tier_num, container.container_type)
                .some((code) => code === targetCode)
        )
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
    const slots = state.slotCatalog.filter((slot) => slot.block === block);
    if (slots.length) return slots;
    const layout = getBlockLayout(block);
    const fallback = [];
    layout.rows.forEach((row) => layout.bays.forEach((bay) => fallback.push(getFallbackSlotRecord(block, bay, row))));
    return fallback;
}

function getSlotRecord(block, bay, row) {
    return getBlockSlotRecords(block).find((slot) => slot.bay === bay && Number(slot.row_num) === Number(row)) || getFallbackSlotRecord(block, bay, row);
}

function renderDashboard() {
    clampViewport();
    renderStats();
    renderOverview();
    renderBayGrid();
    renderInventoryTable();
    renderInspector();
    renderActivityFeed();
    updateLiveStatus();
}

function renderStats() {
    const totalContainers = state.inventory.length;
    const todayIn = countOperationsForToday("STACK_IN");
    const todayOut = countOperationsForToday("STACK_OUT");
    const slots = getBlockSlotRecords(state.selectedBlock).filter((slot) => slot.enabled);
    const occupiedSlots = getSurfaceOccupancy(state.selectedBlock).size;
    setText("total-containers", String(totalContainers));
    setText("today-in", String(todayIn));
    setText("today-out", String(todayOut));
    setText("selected-block-load", `${occupiedSlots} / ${slots.length}`);
}

function countOperationsForToday(operationType) {
    return state.logs.filter((entry) => entry.operation_type === operationType && formatDate(entry.performed_at) === formatDate(new Date().toISOString())).length;
}

function renderOverview() {
    const overview = document.getElementById("terminal-overview");
    overview.innerHTML = getTerminalLayout().map((layout) => {
        const blockContainers = getBlockContainers(layout.block);
        const blockSlots = getBlockSlotRecords(layout.block).filter((slot) => slot.enabled);
        const occupied = getSurfaceOccupancy(layout.block).size;
        const total = blockSlots.length || (layout.bays.length * layout.rows.length);
        const percent = total === 0 ? 0 : Math.round((occupied / total) * 100);
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
                        <small>${layout.footprint} surface</small>
                    </div>
                </div>
                <div class="terminal-block-track">
                    <span class="terminal-block-track-line"></span>
                    <span class="terminal-block-footprint">${layout.footprint}</span>
                    <span class="terminal-block-track-line"></span>
                </div>
                <div class="terminal-block-grid" style="--mini-columns:${layout.bays.length}; --mini-rows:${layout.rows.length};">${renderMiniGrid(layout)}</div>
                <div class="terminal-block-footer"><span>${blockContainers.length} containers</span><span>${percent}% loaded · ${layout.tierCount} tiers</span></div>
            </button>
        `;
    }).join("");
    overview.querySelectorAll(".terminal-block").forEach((button) => button.addEventListener("click", () => {
        state.selectedBlock = button.dataset.block;
        state.selectedSlotKey = null;
        state.selectedContainerId = null;
        state.rowPage = 0;
        state.bayPage = 0;
        renderDashboard();
    }));
}

function renderMiniGrid(layout) {
    const cells = [];
    [...layout.rows].reverse().forEach((row, rowIndex) => {
        layout.bays.forEach((bay, bayIndex) => {
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
    bayGrid.querySelectorAll(".slot-cell").forEach((cell) => {
        cell.addEventListener("click", () => handleSlotClick(cell.dataset.slotKey, cell.dataset.containerId || null));
        if (cell.dataset.containerId) {
            cell.addEventListener("dragstart", handleSlotDragStart);
            cell.addEventListener("dragend", handleSlotDragEnd);
        }
        cell.addEventListener("dragover", handleSlotDragOver);
        cell.addEventListener("dragleave", handleSlotDragLeave);
        cell.addEventListener("drop", handleSlotDrop);
    });
}

function renderSlotCell({ block, bay, row, slotRecord, slotContainers, visibleContainer, tierCount, gridColumn, gridRow, spanCols, condensed = false }) {
    const slotBay = visibleContainer && canContainerSpanHorizontal(visibleContainer) ? getSurfaceStartBayFromWideAnchor(bay) : bay;
    const slotKey = getSlotKey(block, slotBay, row);
    const isSelected = state.selectedSlotKey === slotKey;
    const isMoveTarget = state.moveDraftContainerId && state.selectedSlotKey === slotKey;
    const isDragHover = state.dragOverSlotKey === slotKey;
    const canDrag = Boolean(visibleContainer && state.currentUser?.permissions?.includes("restow"));
    const canDropHere = Boolean(state.draggingContainerId && canDropContainerOnSlot(state.draggingContainerId, slotKey));
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
        <button type="button" class="${classes}" style="grid-column:${gridColumn} / span ${spanCols};grid-row:${gridRow};" data-slot-key="${slotKey}" data-container-id="${visibleContainer ? visibleContainer.container_id : ""}" draggable="${canDrag ? "true" : "false"}">
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
    if (!state.inventory.length) {
        inventoryList.innerHTML = `<tr><td colspan="5" style="text-align:center;">No container data</td></tr>`;
        return;
    }
    inventoryList.innerHTML = state.inventory.map((item) => `<tr data-container-id="${item.container_id}"><td><strong>${item.container_id}</strong></td><td>${item.container_type}</td><td><span class="tag">${item.position_code}</span></td><td>${item.status}</td><td>${item.direction}</td></tr>`).join("");
    inventoryList.querySelectorAll("tr[data-container-id]").forEach((row) => row.addEventListener("click", () => {
        const container = findContainerById(row.dataset.containerId);
        if (!container) return;
        state.selectedBlock = container.block;
        state.selectedSlotKey = getSlotKey(container.block, getSurfaceStartBay(container), container.row_num);
        state.selectedContainerId = container.container_id;
        ensureSlotVisible(container.block, container.bay, container.row_num);
        ensureContainerHistory(container.container_id);
        syncFormsFromSelection();
        openTab("dashboard-tab");
        renderDashboard();
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
        ? `<span class="detail-label">Selected container</span><strong>${selectedContainer.container_id}</strong><small>${selectedContainer.container_type} · ${selectedContainer.status} · ${selectedContainer.direction}</small><small>${selectedContainer.position_code}</small>`
        : `<span class="detail-label">Selected container</span><strong>${slotRecord.enabled ? "Slot is free" : "Slot is blocked"}</strong><small>${slotRecord.enabled ? "Use this address for Stack In or as a Restow target." : "Admin must unblock this slot before it can accept containers."}</small>`;
    renderStackLayers(slotContainers);
    renderHistory(selectedContainer ? selectedContainer.container_id : null);
    renderRoutingPreview(selectedContainer);
    syncFormsFromSelection({ force: true });
    moveButton.innerHTML = state.moveDraftContainerId ? `<i class="fa-solid fa-xmark"></i> Cancel Move Mode` : `<i class="fa-solid fa-arrows-up-down-left-right"></i> Prepare Restow`;
    moveButton.disabled = !selectedContainer && !state.moveDraftContainerId;
    stackOutButton.disabled = !selectedContainer;
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
    state.selectedSlotKey = slotKey;
    const parsed = parseSlotKey(slotKey);
    state.selectedBlock = parsed.block;
    ensureSlotVisible(parsed.block, parsed.bay, parsed.row);
    const slotContainers = getSlotContainers(parsed.block, parsed.bay, parsed.row);
    const visibleContainer = slotContainers.find((container) => container.container_id === containerId) || getVisibleContainerForSlot(slotContainers) || getTopContainer(slotContainers);
    state.selectedContainerId = visibleContainer ? visibleContainer.container_id : null;
    if (state.selectedContainerId) ensureContainerHistory(state.selectedContainerId);
    syncFormsFromSelection();
    renderDashboard();
}

function handleMoveTargetSelection(targetSlotKey) {
    const moveTarget = resolveMoveTarget(state.moveDraftContainerId, targetSlotKey);
    if (moveTarget.error) {
        showToast(moveTarget.error, "error");
        return;
    }
    setValue("restow-id", moveTarget.movingContainer.container_id);
    setValue("restow-block", moveTarget.target.block);
    setValue("restow-bay", moveTarget.target.bay);
    setValue("restow-row", String(moveTarget.target.row));
    setValue("restow-tier", String(moveTarget.nextTier));
    state.selectedSlotKey = targetSlotKey;
    state.selectedContainerId = moveTarget.movingContainer.container_id;
    state.selectedBlock = moveTarget.target.block;
    ensureSlotVisible(moveTarget.target.block, moveTarget.target.bay, moveTarget.target.row);
    state.moveDraftContainerId = null;
    renderDashboard();
    openTab("restow-tab");
    showToast(`Restow prepared: ${moveTarget.movingContainer.container_id} -> ${moveTarget.target.block}-${moveTarget.target.bay}-${moveTarget.target.row}-${moveTarget.nextTier}.`, "success");
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
    if (!hasSupportingBase(target.block, target.bay, target.row, nextTier, movingContainer.container_type)) {
        return { error: `${movingContainer.container_type} is not supported by the tier below in this slot.` };
    }
    const occupant = findPositionOccupant(target.block, target.bay, target.row, nextTier, movingContainer.container_type, movingContainer.container_id);
    if (occupant) return { error: `Selected slot is already occupied by ${occupant.container_id} on tier ${nextTier}.` };
    return { movingContainer, target, slotRecord, nextTier };
}

function canDropContainerOnSlot(containerId, targetSlotKey) {
    return !resolveMoveTarget(containerId, targetSlotKey).error;
}

async function executeRestowMove(containerIdOrMoveTarget, targetSlotKey) {
    const moveTarget = typeof containerIdOrMoveTarget === "object" ? containerIdOrMoveTarget : resolveMoveTarget(containerIdOrMoveTarget, targetSlotKey);
    if (moveTarget.error) {
        showToast(moveTarget.error, "error");
        return;
    }
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
    await loadInventory({ silent: true });
    state.selectedSlotKey = resolvedTargetSlotKey;
    state.selectedContainerId = moveTarget.movingContainer.container_id;
    state.selectedBlock = moveTarget.target.block;
    ensureSlotVisible(moveTarget.target.block, moveTarget.target.bay, moveTarget.target.row);
    renderDashboard();
    showToast(data.message || "Container moved.", "success");
}

function handleSlotDragStart(event) {
    const containerId = event.currentTarget.dataset.containerId;
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
    renderInspector();
}

function handleSlotDragEnd() {
    state.draggingContainerId = null;
    state.dragOverSlotKey = null;
    if (!state.pendingMove) state.moveDraftContainerId = null;
    renderDashboard();
}

function handleSlotDragOver(event) {
    if (!state.draggingContainerId) return;
    const slotKey = event.currentTarget.dataset.slotKey;
    if (!canDropContainerOnSlot(state.draggingContainerId, slotKey)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    state.dragOverSlotKey = slotKey;
    event.currentTarget.classList.add("is-drop-target");
}

function handleSlotDragLeave(event) {
    if (state.dragOverSlotKey === event.currentTarget.dataset.slotKey) {
        state.dragOverSlotKey = null;
        event.currentTarget.classList.remove("is-drop-target");
    }
}

function handleSlotDrop(event) {
    if (!state.draggingContainerId) return;
    event.preventDefault();
    const moveTarget = resolveMoveTarget(state.draggingContainerId, event.currentTarget.dataset.slotKey);
    if (moveTarget.error) {
        showToast(moveTarget.error, "error");
        return;
    }
    state.draggingContainerId = null;
    state.dragOverSlotKey = null;
    openMoveConfirmModal(moveTarget);
}

function syncFormsFromSelection(options = {}) {
    const force = Boolean(options.force);
    if (state.selectedSlotKey) {
        const parsed = parseSlotKey(state.selectedSlotKey);
        const slotRecord = getSlotRecord(parsed.block, parsed.bay, parsed.row);
        const nextTier = getNextAvailableTier(getSlotContainers(parsed.block, parsed.bay, parsed.row), slotRecord.max_tiers) || slotRecord.max_tiers;
        if (force || !state.formDirty.stackin) {
            setValue("in-block", parsed.block);
            setValue("in-bay", state.selectedContainerId && isWideContainer(findContainerById(state.selectedContainerId)) ? findContainerById(state.selectedContainerId).bay : parsed.bay);
            setValue("in-row", String(parsed.row));
            setValue("in-tier", String(nextTier));
        }
    }
    if (state.selectedContainerId) {
        if (force || !state.formDirty.stackout) {
            setValue("out-id", state.selectedContainerId);
        }
        if (force || !state.formDirty.restow) {
            setValue("restow-id", state.selectedContainerId);
        }
    }
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
    state.selectedSlotKey = slotKey;
    state.selectedContainerId = getVisibleContainerForSlot(getSlotContainers(layout.block, surfaceBay, row))?.container_id || null;
    ensureSlotVisible(layout.block, bay, row);
    if (state.selectedContainerId) ensureContainerHistory(state.selectedContainerId);
    syncFormsFromSelection();
    renderDashboard();
    showToast(`Jumped to ${layout.block}-${bay}-${row}.`, "success");
}

function getBlockContainers(block) {
    return state.inventory.filter((container) => container.block === block);
}

function getSlotContainers(block, bay, row) {
    return state.inventory
        .filter((container) => {
            if (container.block !== block || Number(container.row_num) !== Number(row)) return false;
            return getSurfaceBaysForPlacement(container.block, container.bay, container.container_type).includes(formatBayNumber(bay));
        })
        .sort((a, b) => a.tier_num - b.tier_num);
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
    return state.inventory.find((container) => container.container_id === containerId) || null;
}

function getSlotKey(block, bay, row) {
    return `${block}-${bay}-${row}`;
}

function parseSlotKey(slotKey) {
    const [block, bay, row] = slotKey.split("-");
    return { block, bay, row: Number(row) };
}

function humanizeOperation(operationType) {
    return {
        STACK_IN: "Stack In",
        STACK_OUT: "Stack Out",
        RESTOW: "Restow",
    }[operationType] || operationType;
}

function formatDate(value) {
    return new Date(value).toISOString().slice(0, 10);
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

function on(id, event, handler) {
    document.getElementById(id).addEventListener(event, handler);
}

function value(id) {
    return document.getElementById(id).value.trim();
}

function numberValue(id) {
    return Number(document.getElementById(id).value);
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
