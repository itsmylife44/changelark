-- Deleting an app or release cascades to its votes, and the counter trigger then updates up_count/down_count.
-- Developers have no UPDATE on those columns (on purpose), so the trigger must run as its owner.
-- Safe: it only returns `trigger`, so nobody can call it directly, and it only moves counts by the deleted/changed vote.
alter function private.apply_vote() security definer;
revoke execute on function private.apply_vote() from public, anon, authenticated;
