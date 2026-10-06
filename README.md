# 银行反欺诈告警关系分析与案件调查平台

基于 React、Mantine、Redux Toolkit、RTK Query、React Router、React Flow、Vite 和 TypeScript 实现的中文前端项目。项目使用浏览器 `localStorage` 模拟服务端数据库，不依赖外部后端即可运行。

## 功能

- 告警中心：关键词、风险等级、状态和渠道组合筛选，批量关联案件或排除。
- 案件工作台：案件列表、风险状态和调查工作量概览。
- 关系图谱：账户、设备、IP、商户关系布局，节点拖动持久化，关系解释与弱关联区分。
- 联动时间轴：交易、告警和证据按时间排序，点击后高亮对应关系。
- 证据台账：来源、发生时间、提交人、附件标识、证据强度和版本记录。
- 结论版本：保存草稿或提交复核，支持通过、退回补证和案件状态流转。
- 审计报告：操作人和时间不可变留痕，支持 JSON、CSV 导出及演示数据重置。

## 技术栈

- React 19 + TypeScript
- Mantine 9
- Redux Toolkit + RTK Query
- React Router
- React Flow
- Vite

## 运行

```bash
npm install
npm run dev
```

访问 `http://localhost:18458`。

## 构建

```bash
npm run build
npm run preview
```

`npm run build` 会先执行严格 TypeScript 检查，再生成 Vite 生产构建。

## 数据说明

首次打开时会将演示案件写入 `localStorage`。后续新增证据、结论、关系节点和状态流转会持久化到同一浏览器存储；“审计与报告”页面可以重置全部演示数据。
