import { Request, Response } from 'express';
import { gql } from '../_shared/engine';

// Bootstrapping a brand-new org is a chicken-and-egg problem for row
// permissions: inserting into org_members requires the caller to already be
// an `owner` in that org, but nobody is a member yet right after the org
// row is created. Rather than weaken the org_members insert permission to
// make that work (which would open a hole for adding members to *existing*
// orgs), this Action does both inserts itself, admin-authenticated, and
// only for the calling user as `owner` of the org they just created.
export default async (req: Request, res: Response) => {
  try {
    const sessionVars = req.body.session_variables || {};
    const userId = sessionVars['x-hasura-user-id'];
    if (!userId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const input = req.body.input?.input || req.body.input;
    const name = (input?.name as string || '').trim();
    if (!name) {
      return res.status(400).json({ message: 'Organization name is required' });
    }

    const orgResult = await gql(`
      mutation CreateOrg($name: String!) {
        insert_organizations_one(object: { name: $name }) {
          id name quota_limit quota_used
        }
      }
    `, { name });

    const org = orgResult.insert_organizations_one;

    await gql(`
      mutation AddOwner($orgId: uuid!, $userId: uuid!) {
        insert_org_members_one(object: { org_id: $orgId, user_id: $userId, role: owner }) { id }
      }
    `, { orgId: org.id, userId });

    return res.json({ id: org.id, name: org.name });
  } catch (err) {
    console.error('createOrganization error:', err);
    return res.status(500).json({ message: (err as Error).message });
  }
};
