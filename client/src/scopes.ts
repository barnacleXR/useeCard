import type { McpScope } from '@ccm/shared';
// MCP 授权页与设置页共用的权限说明。
export const mcpScopeLabels: Record<McpScope, string> = {
  'accounts:read': '读取扣款账户', 'cards:read': '读取信用卡', 'bills:read': '读取账单', 'summary:read': '读取备款汇总', 'reviews:read': '读取月度检查',
  'bills:write': '录入、修改、确认扣款与作废账单', 'reviews:write': '标记月度检查（无新增 / 已核对）',
};
export const mcpWriteScopes: McpScope[] = ['bills:write', 'reviews:write'];
