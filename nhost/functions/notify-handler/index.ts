import { Request, Response } from 'express';

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const NOTIFY_FROM_EMAIL = process.env.NOTIFY_FROM_EMAIL || '';

export default async (req: Request, res: Response) => {
  try {
    const suppliedSecret = req.headers['x-hasura-admin-secret'];
    if (suppliedSecret !== (process.env.NHOST_ADMIN_SECRET || '')) {
      return res.status(401).json({ message: 'Invalid event trigger credentials' });
    }

    const event = req.body.event?.data?.new;
    if (!event) return res.status(400).json({ message: 'Missing event payload' });

    const channel = String(event.channel || '');
    const message = String(event.message || '');
    const config = event.config || {};

    if (channel === 'slack') {
      const webhookUrl = String(config.webhook_url || process.env.SLACK_WEBHOOK_URL || '');
      if (!webhookUrl) return res.status(400).json({ message: 'Slack webhook URL is not configured' });
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: message }),
      });
      if (!response.ok) throw new Error(`Slack webhook failed: ${response.status}`);
    } else if (channel === 'email') {
      const to = String(config.to || '');
      if (!RESEND_API_KEY || !NOTIFY_FROM_EMAIL || !to) {
        throw new Error('Email notification requires RESEND_API_KEY, NOTIFY_FROM_EMAIL, and config.to');
      }
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: NOTIFY_FROM_EMAIL,
          to: [to],
          subject: 'AI Workflow notification',
          text: message,
        }),
      });
      if (!response.ok) throw new Error(`Email provider failed: ${response.status}`);
    } else {
      throw new Error(`Unsupported notification channel: ${channel}`);
    }

    return res.json({ success: true, channel });
  } catch (err) {
    console.error('notify-handler error:', err);
    return res.status(500).json({ message: (err as Error).message });
  }
};
