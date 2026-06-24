# 店铺会员积分系统在线版

这是一个静态前端 + Supabase 云数据库的多人协作系统。

## 功能

- 邮箱注册和登录
- 创建店铺、邀请码加入店铺
- 同一店铺成员共享会员、消费、兑换、规则和年度结算数据
- Supabase Row Level Security 隔离不同店铺
- 云端实时刷新
- GitHub Pages 自动部署

## 1. 创建 Supabase 项目

1. 登录 [Supabase](https://supabase.com/) 并创建项目。
2. 打开 `SQL Editor`，执行 `supabase-schema.sql` 的全部内容。
3. 在 `Authentication > Providers > Email` 中启用邮箱登录。
4. 开发测试阶段可关闭 `Confirm email`；正式使用建议开启邮箱验证。
5. 在 `Project Settings > API` 复制：
   - Project URL
   - anon / publishable key

不要把 `service_role` key 放入网页。

## 2. 填写前端配置

编辑 `config.js`：

```js
window.SUPABASE_CONFIG = {
  url: "https://你的项目编号.supabase.co",
  anonKey: "你的 anon key"
};
```

anon key 是设计用于浏览器端的公开密钥，数据安全由登录身份和 RLS 策略控制。

## 3. 发布到 GitHub Pages

1. 在 GitHub 新建仓库，例如 `member-points-online`。
2. 将本目录中的全部文件提交到仓库默认分支。
3. 打开仓库 `Settings > Pages`。
4. 在 `Build and deployment` 中选择 `GitHub Actions`。
5. 推送代码后，工作流会自动发布。

公共网址通常为：

`https://你的GitHub用户名.github.io/member-points-online/`

之后每次修改源码并 `git push`，GitHub Pages 会自动更新公共网站。

## 4. 第一次使用

1. 打开公共网址并注册管理账号。
2. 创建店铺。
3. 侧边栏会显示店铺邀请码。
4. 其他员工注册后，输入邀请码即可加入并共享数据。

## 安全说明

- 不要在源码中保存 GitHub 密码、Supabase 数据库密码或 `service_role` key。
- 建议为 GitHub 和 Supabase 开启两步验证。
- 邀请码持有者将以编辑者身份加入，请只发送给可信员工。
- 当前数据状态采用整店 JSON 文档保存，适合小型门店协作；高并发或多门店集团版建议升级为关系型逐表写入与审计日志。
