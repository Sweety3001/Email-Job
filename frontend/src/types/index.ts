// Shared API types — mirror backend responses exactly.

export interface User {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}

export type EmailStatus = "scheduled" | "sending" | "sent" | "failed";

export interface EmailRow {
  id: string;
  recipient: string;
  subject: string;
  status: EmailStatus;
  scheduledAt: string;
  sentAt: string | null;
  error: string | null;
  previewUrl: string | null;
  attempts: number;
  campaignId: string;
  campaign: { name: string } | null;
}

export interface EmailListResponse {
  total: number;
  page: number;
  pageSize: number;
  emails: EmailRow[];
}

export interface CampaignRow {
  id: string;
  name: string;
  subject: string;
  startTime: string;
  delaySeconds: number;
  status: string;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  createdAt: string;
}

export interface ScheduleCampaignRequest {
  name?: string;
  subject: string;
  body: string;
  recipients: string[];
  startTime: string;
  delaySeconds: number;
  hourlyLimit?: number;
}

export interface ScheduleCampaignResponse {
  campaignId: string;
  queued: number;
  skippedDuplicates: number;
  firstSendAt: string;
  lastSendAt: string;
}

export interface StatsResponse {
  emails: { scheduled: number; sending: number; sent: number; failed: number };
  queue: { waiting: number; delayed: number; active: number; failed: number; completed: number };
  rate: {
    globalCountThisHour: number;
    maxEmailsPerHour: number;
    maxEmailsPerHourPerSender: number;
    mode: "global" | "sender" | "both";
    minDelayMs: number;
    workerConcurrency: number;
  };
  slackConnected: boolean;
  elasticsearchAvailable: boolean;
}

export interface SenderRow {
  id: string;
  name: string;
  email: string;
}

export interface SlackStatusResponse {
  connected: boolean;
  teamName: string | null;
  scopes: string | null;
}

export interface SearchHit {
  id: string;
  recipient: string;
  subject: string;
  status: string;
  scheduledAt: string;
  sentAt: string | null;
  campaignId: string;
  campaignName?: string;
  error?: string | null;
}

export interface SearchResponse {
  query: string;
  results: SearchHit[];
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
