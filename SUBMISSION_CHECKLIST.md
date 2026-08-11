# Submission Checklist

## Repository

- [x] PostgreSQL migrations committed
- [x] Hasura metadata committed
- [x] Actions committed
- [x] Cron triggers committed
- [x] Event Trigger metadata committed
- [x] Next.js frontend committed
- [x] README with local setup
- [x] Architecture / one-page write-up
- [x] Final Task demo runbook
- [x] Demo seed template

## Live deployment — complete before submission

- [ ] Create/link Nhost Cloud project
- [ ] Deploy migrations and Hasura metadata
- [ ] Configure production function secrets
- [ ] Add Groq API key, or explicitly enable the disclosed stub mode
- [ ] Verify every Action endpoint in the deployed environment
- [ ] Deploy `frontend` to Vercel (or equivalent)
- [ ] Configure the five frontend public environment variables
- [ ] Add the deployed frontend origin to Hasura CORS settings
- [ ] Open the deployed URL in a clean/incognito browser and verify login
- [ ] Verify GraphQL subscriptions over the deployed endpoint

## Final Task proof — complete before submission

- [ ] Org Alpha exists
- [ ] Org Beta exists
- [ ] Alpha owner exists
- [ ] Alpha editor exists
- [ ] Beta owner exists
- [ ] Beta editor exists
- [ ] Alpha workflow has `llm_call`
- [ ] Alpha workflow has `http_request`
- [ ] Alpha workflow has `conditional_branch`
- [ ] Alpha workflow has `approval_gate`
- [ ] Alpha workflow has `notify`
- [ ] Notify Event Trigger delivers a real Slack/email alert
- [ ] Manual trigger works
- [ ] Non-manual trigger works (webhook or database event)
- [ ] Live step subscription shows progress without refresh
- [ ] Approval pauses the run
- [ ] Alpha owner/editor can approve
- [ ] Beta editor cannot read Alpha workflow by guessed ID
- [ ] Beta editor cannot trigger Alpha workflow by guessed ID
- [ ] Beta editor cannot approve Alpha step by guessed ID
- [ ] Quota indicator is visible
- [ ] Final scenario is recorded

## Submission package

Submit:

1. GitHub repository URL
2. Hosted Next.js URL
3. Short Final Task recording URL/file
4. If requested, demo credentials shared privately with the reviewer

Never commit API keys, admin secrets, or real user passwords.
