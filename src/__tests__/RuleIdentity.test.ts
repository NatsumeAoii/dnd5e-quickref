import { describe, expect, it } from 'vitest';
import { getLegacyRuleId, getRuleId, isStableRuleId } from '../utils/RuleIdentity.js';

describe('Rule identity compatibility', () => {
    it('prefers explicit locale-independent ids', () => {
        expect(getRuleId({ id: 'core.action.dodge', title: 'Esquiver' }, 'basic-actions', 0)).toBe('core.action.dodge');
        expect(isStableRuleId('core.action.dodge')).toBe(true);
    });

    it('preserves legacy identity until source data is backfilled', () => {
        expect(getRuleId({ title: 'Dodge' }, 'basic-actions', 0)).toBe('legacy.2014.basic-actions.1');
        expect(getLegacyRuleId('Action', 'Dodge')).toBe('Action::Dodge');
        expect(isStableRuleId('Action::Dodge')).toBe(false);
    });
});
