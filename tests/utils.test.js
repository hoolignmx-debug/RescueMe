import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TRANSITIONS, isValidTransition, allowedTransitions, STATUSES, isCritical, isIncoming, severityRank,
} from '../src/utils/statuses.js';
import { can } from '../src/utils/permissions.js';
import {
  validateLogin, validateParamedicHandoff, validateDoctorAssessment, validateStatusChange, validateTreatmentNote, hasErrors,
} from '../src/utils/validators.js';
import { formatEta, toLocalInputValue } from '../src/utils/format.js';

test('status workflow only allows ARRIVED -> IN_ER -> UNDER_TREATMENT -> STABLE|OTHER_OUTCOME -> CLOSED', () => {
  assert.ok(isValidTransition('EN_ROUTE', 'ARRIVED'));
  assert.ok(isValidTransition('ARRIVED', 'IN_ER'));
  assert.ok(isValidTransition('IN_ER', 'UNDER_TREATMENT'));
  assert.ok(isValidTransition('UNDER_TREATMENT', 'STABLE'));
  assert.ok(isValidTransition('UNDER_TREATMENT', 'OTHER_OUTCOME'));
  assert.ok(isValidTransition('STABLE', 'CLOSED'));
  assert.ok(isValidTransition('OTHER_OUTCOME', 'CLOSED'));
  assert.ok(!isValidTransition('ARRIVED', 'CLOSED'));
  assert.ok(!isValidTransition('IN_ER', 'ARRIVED'), 'no going backwards');
  assert.ok(!isValidTransition('CLOSED', 'IN_ER'), 'closed is final');
  assert.ok(!isValidTransition('AMBULANCE_ASSIGNED', 'ARRIVED'), 'EMS-owned stages are not skipped');
  for (const to of Object.values(TRANSITIONS).flat()) assert.ok(STATUSES.includes(to));
});

test('role-specific transitions', () => {
  assert.deepEqual(allowedTransitions('UNDER_TREATMENT', 'ER_DOCTOR'), ['STABLE', 'OTHER_OUTCOME']);
  assert.deepEqual(allowedTransitions('UNDER_TREATMENT', 'PARAMEDIC'), []);
  assert.deepEqual(allowedTransitions('ARRIVED', 'PARAMEDIC'), ['IN_ER']);
  assert.deepEqual(allowedTransitions('ARRIVED', 'ADMIN'), []);
});

test('permissions follow the role matrix', () => {
  assert.ok(can('ER_DOCTOR', 'handoff.accept'));
  assert.ok(!can('PARAMEDIC', 'handoff.accept'));
  assert.ok(can('PARAMEDIC', 'handoff.submit_paramedic'));
  assert.ok(!can('ER_DOCTOR', 'audit.view'));
  assert.ok(can('ADMIN', 'audit.view'));
  assert.ok(!can('ADMIN', 'profile.view'));
  assert.ok(!can('SOMEONE', 'incidents.view'));
});

test('dashboard card definitions', () => {
  assert.ok(isIncoming({ status: 'EN_ROUTE' }));
  assert.ok(!isIncoming({ status: 'ARRIVED' }));
  assert.ok(isCritical({ status: 'IN_ER', severity: 'CRITICAL' }));
  assert.ok(!isCritical({ status: 'STABLE', severity: 'CRITICAL' }));
  assert.ok(severityRank('CRITICAL') < severityRank('LOW') && severityRank('LOW') < severityRank('UNKNOWN'));
});

test('login validation', () => {
  assert.ok(hasErrors(validateLogin({ identifier: '', password: '' })));
  assert.ok(hasErrors(validateLogin({ identifier: 'DOC-001', password: '' })));
  assert.ok(!hasErrors(validateLogin({ identifier: 'DOC-001', password: 'x' })));
});

test('handoff validation', () => {
  const empty = validateParamedicHandoff({});
  for (const f of ['arrival_time', 'initial_condition', 'consciousness', 'breathing', 'visible_injuries', 'initial_observations']) {
    assert.ok(empty[f], `${f} is required`);
  }
  assert.ok(validateParamedicHandoff({ arrival_time: new Date(Date.now() + 3600e3).toISOString() }).arrival_time, 'future arrival time rejected');
  assert.ok(validateParamedicHandoff({ initial_condition: 'x'.repeat(2001) }).initial_condition);
  const ok = {
    arrival_time: new Date().toISOString(), initial_condition: 'a', consciousness: 'ALERT', breathing: 'NORMAL',
    visible_injuries: 'None observed', initial_observations: 'b',
  };
  assert.ok(!hasErrors(validateParamedicHandoff(ok)));

  assert.ok(validateDoctorAssessment({}).initial_assessment);
  assert.ok(!hasErrors(validateDoctorAssessment({ doctor_id: 'D', doctor_name: 'N', accepted_at: new Date().toISOString(), initial_assessment: 'x' })));
  assert.ok(validateTreatmentNote('  ').text);
  assert.ok(validateStatusChange({ to: 'OTHER_OUTCOME', notes: '' }).notes);
  assert.ok(!hasErrors(validateStatusChange({ to: 'STABLE', notes: '' })));
});

test('formatting helpers handle missing values', () => {
  assert.equal(formatEta(null), 'Not available');
  assert.equal(formatEta(undefined), 'Not available');
  assert.equal(formatEta(0), 'Arriving now');
  assert.equal(formatEta(8), '8 min');
  assert.equal(formatEta(75), '1 h 15 min');
  assert.equal(toLocalInputValue('garbage'), '');
});
