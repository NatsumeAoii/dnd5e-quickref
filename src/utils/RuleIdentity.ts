import type { RuleData } from '../types.js';

const SAFE_ID_PART = /[^a-z0-9]+/g;

export const slugifyRuleTitle = (title: string): string =>
    title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(SAFE_ID_PART, '-').replace(/^-+|-+$/g, '') || 'untitled';

/**
 * Uses an explicit source id for the shipped corpus. The positional fallback is
 * retained only for legacy fixtures or externally constructed data; the data
 * audit rejects missing ids from the supported source corpus.
 */
export const getRuleId = (rule: RuleData, categoryId: string, index: number, ruleset: '2014' | '2024' = '2014'): string =>
    rule.id?.trim() || `legacy.${ruleset}.${categoryId}.${index + 1}`;

export const getLegacyRuleType = (categoryId: string): string => categoryId.startsWith('environment-') ? 'Environment' : ({
        'basic-movement': 'Move',
        'basic-actions': 'Action',
        'basic-bonus-actions': 'Bonus action',
        'basic-reactions': 'Reaction',
        'basic-conditions': 'Condition',
    }[categoryId] ?? categoryId);

export const getLegacyRuleId = (type: string, title: string): string => `${type}::${title}`;

export const getRuleMapKey = (rule: RuleData, type: string): string =>
    rule.id?.trim() || getLegacyRuleId(type, rule.title ?? 'Untitled');

export const isStableRuleId = (id: string): boolean =>
    /^(?:[a-z0-9][a-z0-9_-]*\.){1,4}[a-z0-9_-]+(?:-[a-z0-9-]+)*$/.test(id);
