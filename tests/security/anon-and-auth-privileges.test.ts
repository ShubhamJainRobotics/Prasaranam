import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createAnonClient,
  createRealTestUser,
  deleteRealTestUser,
  TestUser,
} from '@relay/test-fixtures';

describe('Security: Anon and Authenticated Privileges (2A.1 & 22.3 item 30)', () => {
  let user: TestUser;
  const anonClient = createAnonClient();

  beforeAll(async () => {
    user = await createRealTestUser(
      `test-priv-${Date.now()}@relay.local`,
      'Password123!',
      'Privilege Tester'
    );
  });

  afterAll(async () => {
    if (user) await deleteRealTestUser(user.userId);
  });

  it('anon client cannot insert into any application table', async () => {
    const tables = [
      'organisations',
      'projects',
      'sources',
      'claims',
      'handovers',
      'jobs',
      'audit_events',
    ];

    for (const table of tables) {
      const { error } = await anonClient.from(table).insert({ name: 'malicious' });
      expect(error).not.toBeNull();
      // Error code 42501 (insufficient_privilege) or PGRST error
      expect(error?.code || error?.message).toBeDefined();
    }
  });

  it('anon client cannot read application data from sensitive tables', async () => {
    const sensitiveTables = [
      'organisations',
      'projects',
      'sources',
      'claims',
      'handovers',
      'jobs',
      'audit_events',
    ];

    for (const table of sensitiveTables) {
      const { data, error } = await anonClient.from(table).select('*');
      // Anon either receives a permission denied error or an empty list
      if (error) {
        expect(error.code || error.message).toBeDefined();
      } else {
        expect(data).toEqual([]);
      }
    }
  });

  it('authenticated user cannot insert, update, or delete via Data API (mutations restricted to app_private)', async () => {
    // Attempt direct INSERT on organisations
    const { error: insertError } = await user.client
      .from('organisations')
      .insert({ name: 'Hacked Org', created_by: user.userId });
    expect(insertError).not.toBeNull();
    expect(insertError?.code).toBe('42501'); // permission denied for table organisations

    // Attempt direct INSERT on projects
    const { error: projInsertError } = await user.client
      .from('projects')
      .insert({ name: 'Hacked Project', created_by: user.userId });
    expect(projInsertError).not.toBeNull();
    expect(projInsertError?.code).toBe('42501');

    // Attempt direct INSERT on sources
    const { error: srcInsertError } = await user.client
      .from('sources')
      .insert({ title: 'Hacked Source', content: 'hacked' });
    expect(srcInsertError).not.toBeNull();
    expect(srcInsertError?.code).toBe('42501');

    // Attempt direct UPDATE on projects
    const { error: updateError } = await user.client
      .from('projects')
      .update({ name: 'Renamed' })
      .eq('name', 'anything');
    expect(updateError).not.toBeNull();
    expect(updateError?.code).toBe('42501');

    // Attempt direct DELETE on claims
    const { error: deleteError } = await user.client
      .from('claims')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
    expect(deleteError).not.toBeNull();
    expect(deleteError?.code).toBe('42501');
  });

  it('anon and authenticated cannot call app_private mutation functions via Data API RPC', async () => {
    // Try calling bootstrap_organisation via anon RPC
    const { error: anonRpcError } = await anonClient.rpc('bootstrap_organisation', {
      p_actor_id: user.userId,
      p_org_name: 'Anon Org',
    });
    expect(anonRpcError).not.toBeNull();

    // Try calling bootstrap_organisation via user client RPC
    const { error: userRpcError } = await user.client.rpc('bootstrap_organisation', {
      p_actor_id: user.userId,
      p_org_name: 'Direct User Org',
    });
    expect(userRpcError).not.toBeNull();
  });
});
