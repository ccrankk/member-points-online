(function () {
  const config = window.SUPABASE_CONFIG || {};
  let client = null;
  let currentStore = null;
  let channel = null;
  let saveTimer = null;
  let onStateChange = null;
  let defaultState = null;

  const configured = Boolean(config.url && config.anonKey && window.supabase);
  const authScreen = document.getElementById("authScreen");
  const authPanel = document.getElementById("authPanel");
  const workspacePanel = document.getElementById("workspacePanel");
  const setupPanel = document.getElementById("setupPanel");
  const authForm = document.getElementById("authForm");
  const authSwitch = document.getElementById("authSwitch");
  const authTitle = document.getElementById("authTitle");
  const authCopy = document.getElementById("authCopy");
  const authSubmit = document.getElementById("authSubmit");
  const authMessage = document.getElementById("authMessage");
  const workspaceMessage = document.getElementById("workspaceMessage");
  let authMode = "login";

  function show(element) {
    [authPanel, workspacePanel, setupPanel].forEach(panel => panel.hidden = panel !== element);
    authScreen.hidden = false;
    document.body.classList.add("cloud-loading");
  }

  function enterApp() {
    authScreen.hidden = true;
    document.body.classList.remove("cloud-loading");
  }

  function message(target, text, error = false) {
    target.textContent = text || "";
    target.classList.toggle("error", error);
  }

  function setSyncState(text, pending = false) {
    const node = document.getElementById("syncState");
    const dot = document.querySelector(".storage-state .status-dot");
    if (node) node.textContent = text;
    if (dot) dot.classList.toggle("pending", pending);
  }

  async function loadWorkspace() {
    const { data: memberships, error } = await client
      .from("store_memberships")
      .select("store_id, role, stores(id, name, invite_code)")
      .order("created_at", { ascending: true })
      .limit(1);
    if (error) throw error;
    if (!memberships?.length) {
      show(workspacePanel);
      return false;
    }
    currentStore = memberships[0].stores;
    document.getElementById("storeName").textContent = currentStore.name;
    document.getElementById("inviteCode").textContent = currentStore.invite_code;
    await loadState();
    subscribe();
    enterApp();
    return true;
  }

  async function loadState() {
    const { data, error } = await client
      .from("store_state")
      .select("data, updated_at")
      .eq("store_id", currentStore.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      const initial = JSON.parse(JSON.stringify(defaultState));
      const { error: insertError } = await client
        .from("store_state")
        .insert({ store_id: currentStore.id, data: initial });
      if (insertError) throw insertError;
      onStateChange(initial);
    } else {
      onStateChange(data.data);
    }
    setSyncState("云端已同步");
  }

  function subscribe() {
    if (channel) client.removeChannel(channel);
    channel = client
      .channel(`store-state-${currentStore.id}`)
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "store_state",
        filter: `store_id=eq.${currentStore.id}`
      }, payload => {
        if (payload.new?.data) {
          onStateChange(payload.new.data);
          setSyncState("已收到最新数据");
        }
      })
      .subscribe();
  }

  async function saveNow(state) {
    if (!client || !currentStore) return;
    setSyncState("正在同步…", true);
    const { error } = await client
      .from("store_state")
      .update({ data: state, updated_at: new Date().toISOString() })
      .eq("store_id", currentStore.id);
    if (error) {
      console.error(error);
      setSyncState("同步失败", true);
      return;
    }
    setSyncState("云端已同步");
  }

  function save(state) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveNow(state), 250);
  }

  async function init(initialState, callback) {
    defaultState = initialState;
    onStateChange = callback;
    if (!configured) {
      show(setupPanel);
      return false;
    }
    client = window.supabase.createClient(config.url, config.anonKey);
    bindEvents();
    const { data } = await client.auth.getSession();
    if (!data.session) {
      show(authPanel);
      return false;
    }
    try {
      return await loadWorkspace();
    } catch (error) {
      console.error(error);
      show(authPanel);
      message(authMessage, "无法读取云端工作区，请检查数据库配置。", true);
      return false;
    }
  }

  function bindEvents() {
    authSwitch.addEventListener("click", () => {
      authMode = authMode === "login" ? "signup" : "login";
      authTitle.textContent = authMode === "login" ? "登录管理系统" : "创建管理账号";
      authCopy.textContent = authMode === "login"
        ? "登录后，店铺成员将看到同一份会员、消费和积分数据。"
        : "注册成功后可创建店铺，或使用同事提供的邀请码加入。";
      authSubmit.textContent = authMode === "login" ? "登录" : "注册";
      authSwitch.textContent = authMode === "login" ? "还没有账号？注册" : "已有账号？登录";
      message(authMessage, "");
    });

    authForm.addEventListener("submit", async event => {
      event.preventDefault();
      const form = new FormData(authForm);
      const credentials = { email: form.get("email"), password: form.get("password") };
      authSubmit.disabled = true;
      message(authMessage, authMode === "login" ? "正在登录…" : "正在注册…");
      const result = authMode === "login"
        ? await client.auth.signInWithPassword(credentials)
        : await client.auth.signUp(credentials);
      authSubmit.disabled = false;
      if (result.error) return message(authMessage, result.error.message, true);
      if (authMode === "signup" && !result.data.session) {
        return message(authMessage, "注册成功，请先到邮箱完成验证，然后再登录。");
      }
      message(authMessage, "");
      await loadWorkspace();
    });

    document.getElementById("createStoreForm").addEventListener("submit", async event => {
      event.preventDefault();
      const name = new FormData(event.currentTarget).get("storeName").trim();
      message(workspaceMessage, "正在创建店铺…");
      const { error } = await client.rpc("create_store", { store_name: name });
      if (error) return message(workspaceMessage, error.message, true);
      message(workspaceMessage, "");
      await loadWorkspace();
    });

    document.getElementById("joinStoreForm").addEventListener("submit", async event => {
      event.preventDefault();
      const code = new FormData(event.currentTarget).get("inviteCode").trim().toUpperCase();
      message(workspaceMessage, "正在加入店铺…");
      const { error } = await client.rpc("join_store", { code });
      if (error) return message(workspaceMessage, error.message, true);
      message(workspaceMessage, "");
      await loadWorkspace();
    });

    document.getElementById("copyInviteCode").addEventListener("click", async () => {
      if (!currentStore) return;
      await navigator.clipboard.writeText(currentStore.invite_code);
      setSyncState("邀请码已复制");
    });
    document.getElementById("signOutButton").addEventListener("click", signOut);
    document.getElementById("signOutFromWorkspace").addEventListener("click", signOut);
  }

  async function signOut() {
    if (channel) await client.removeChannel(channel);
    currentStore = null;
    await client.auth.signOut();
    show(authPanel);
  }

  window.cloudStore = { configured, init, save, signOut };
})();
