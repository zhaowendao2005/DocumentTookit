# 文件选择器迁移指南

## 问题描述

原项目使用的 `inquirer-file-tree-selection-prompt` 插件存在兼容性问题：
- 最后更新时间：3年前
- 与 inquirer v8+ 不兼容
- 依赖过时的 rxjs 版本

## 解决方案

我们开发了一个自定义的文件选择器 `utils/file-selector.js` 来替代有问题的插件。

## 主要改进

### ✅ 解决的问题
- **兼容性问题**: 完全基于 inquirer 原生组件，无兼容性问题
- **功能完整**: 支持文件/目录选择、单选/多选、扩展名过滤
- **用户体验**: 提供导航历史、文件图标、路径显示
- **可维护性**: 纯 JavaScript 实现，易于定制和维护

### 🚀 新功能
- **智能导航**: 支持上级目录、返回上一步
- **文件类型图标**: 根据扩展名显示对应图标
- **扩展名过滤**: 只显示指定类型的文件
- **多选模式**: 支持选择多个文件，实时显示已选列表
- **路径显示**: 实时显示当前所在目录

## 使用方法

### 基本用法

```javascript
const FileSelector = require('./utils/file-selector');
const selector = new FileSelector();

// 选择目录
const dir = await selector.selectDirectory('选择目录');

// 选择单个文件
const file = await selector.selectFile('选择文件', './', ['.txt', '.md']);

// 选择多个文件
const files = await selector.selectFiles('选择多个文件', './', ['.js', '.json']);
```

### 高级用法

```javascript
// 完全自定义选择
const result = await selector.select({
    type: 'both',          // 'file' | 'directory' | 'both'
    multiple: true,        // 是否多选
    startPath: './data',   // 起始路径
    message: '选择项目',    // 提示消息
    extensions: ['.txt']   // 允许的文件扩展名
});
```

## 迁移步骤

### 1. 移除旧依赖
```bash
npm uninstall inquirer-file-tree-selection-prompt
```

### 2. 更新代码
原来的代码：
```javascript
inquirer.registerPrompt('file-tree-selection', require('inquirer-file-tree-selection-prompt'));

const answer = await inquirer.prompt([{
    type: 'file-tree-selection',
    name: 'selection',
    root: startPath,
    multiple: true
}]);
```

新代码：
```javascript
const FileSelector = require('./utils/file-selector');
const selector = new FileSelector();

const result = await selector.select({
    type: 'file',
    multiple: true,
    startPath: startPath
});
```

### 3. 测试验证
运行测试脚本验证功能：
```bash
node test-file-selector.js
```

## 项目中的具体变更

### 文件变更列表
- ✅ 新增: `utils/file-selector.js` - 自定义文件选择器
- ✅ 修改: `modules/ui-interactive.js` - 更新文件选择逻辑
- ✅ 修改: `package.json` - 移除问题依赖
- ✅ 新增: `test-file-selector.js` - 测试脚本
- ✅ 新增: `MIGRATION_GUIDE.md` - 本迁移指南

### 功能对比

| 功能 | 旧版本 | 新版本 |
|------|--------|--------|
| 目录选择 | ✅ | ✅ |
| 文件选择 | ✅ | ✅ |
| 多选支持 | ✅ | ✅ |
| 扩展名过滤 | ❌ | ✅ |
| 导航历史 | ❌ | ✅ |
| 文件图标 | ❌ | ✅ |
| 兼容性 | ❌ | ✅ |
| 可定制性 | ❌ | ✅ |

## 注意事项

1. **路径处理**: 新版本返回绝对路径，确保路径处理的一致性
2. **取消操作**: 用户可以在任何时候取消选择（返回 null）
3. **错误处理**: 增强了错误处理，提供更清晰的错误信息
4. **性能**: 大目录下的性能比旧版本更好

## 后续优化建议

1. **配置文件**: 可以添加配置文件来定制文件图标和行为
2. **搜索功能**: 在大目录中添加文件搜索功能
3. **书签功能**: 支持常用目录的书签功能
4. **预览功能**: 对某些文件类型提供内容预览

## 支持

如果在迁移过程中遇到问题，请检查：
1. Node.js 版本是否 >= 16.0.0
2. inquirer 版本是否为 8.x
3. 文件权限是否正确

建议在生产环境部署前充分测试文件选择功能。
