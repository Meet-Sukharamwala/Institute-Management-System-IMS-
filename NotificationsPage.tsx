import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import { useAppContext } from '../context/AppContext';
import { Permission } from '../shared/types';
import {
  PageHeader,
  LoadingRows,
  ErrorBanner,
  StatusText,
  ModalDialog,
} from '../components/UiPrimitives';

interface NotificationRow {
  id: number;
  branchId: number | null;
  targetRole: string | null;
  eventType: string;
  title: string;
  message: string;
  channel: string;
  deliveryMode: string;
  deliveryStatus: string;
  isRead: number;
  createdAt: string;
}

export function NotificationsPage() {
  const { selectedBranchId, hasPermission, notify } = useAppContext();
  const qc = useQueryClient();
  const [composeOpen, setComposeOpen] = useState(false);

  const [form, setForm] = useState({
    title: '',
    message: '',
    channels: ['IN_APP'] as Array<'IN_APP' | 'EMAIL' | 'SMS' | 'WHATSAPP'>,
  });

  const query = useQuery({
    queryKey: ['notifications'],
    queryFn: () =>
      apiFetch<{
        notifications: NotificationRow[];
        providerStatus: Record<string, boolean>;
      }>('/api/notifications'),
  });

  const handleBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/notifications', {
        method: 'POST',
        body: {
          branchId: selectedBranchId === 'ALL' ? null : Number(selectedBranchId),
          targetRole: null,
          eventType: 'ANNOUNCEMENT',
          title: form.title,
          message: form.message,
          channels: form.channels,
        },
      });
      notify('success', 'Announcement dispatched across selected channels.');
      setComposeOpen(false);
      setForm({ title: '', message: '', channels: ['IN_APP'] });
      await qc.invalidateQueries({ queryKey: ['notifications'] });
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Broadcast failed');
    }
  };

  const toggleChannel = (ch: 'IN_APP' | 'EMAIL' | 'SMS' | 'WHATSAPP') => {
    setForm((prev) => ({
      ...prev,
      channels: prev.channels.includes(ch)
        ? prev.channels.filter((x) => x !== ch)
        : [...prev.channels, ch],
    }));
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications & Campus Announcements"
        subtitle="Centralized event alerts across In-App, Email, SMS, and WhatsApp adapters with transparent sandbox vs live provider tracking."
        actions={
          hasPermission(Permission.NOTIFICATION_MANAGE) ? (
            <button
              type="button"
              onClick={() => setComposeOpen(true)}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-md whitespace-nowrap"
            >
              Publish Announcement
            </button>
          ) : undefined
        }
      />

      {query.data && (
        <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-wrap items-center gap-6 text-xs">
          <span className="font-semibold text-slate-900">Configured Channel Adapters:</span>
          {Object.entries(query.data.providerStatus).map(([ch, live]) => (
            <span key={ch} className="text-slate-600">
              <strong className="font-mono text-slate-900">{ch}:</strong>{' '}
              {live ? (
                <span className="text-emerald-700 font-semibold">Live</span>
              ) : (
                <span className="text-amber-700 font-semibold">Dev Sandbox (Missing Provider Keys)</span>
              )}
            </span>
          ))}
        </div>
      )}

      {query.isLoading ? (
        <LoadingRows />
      ) : query.isError ? (
        <ErrorBanner message="Failed to load notifications" onRetry={() => void query.refetch()} />
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-200">
          {query.data?.notifications.map((n) => (
            <div key={n.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span className="font-mono font-semibold text-slate-800">{n.channel}</span>
                  <span>·</span>
                  <span>{n.eventType.replace(/_/g, ' ')}</span>
                  <span>·</span>
                  <StatusText status={n.deliveryStatus} />
                </div>
                <h3 className="text-sm font-bold text-slate-900">{n.title}</h3>
                <p className="text-xs text-slate-600">{n.message}</p>
              </div>
              <span className="text-xs font-mono text-slate-500 shrink-0 tabular-nums">
                {n.createdAt.slice(0, 16).replace('T', ' ')}
              </span>
            </div>
          ))}
        </div>
      )}

      <ModalDialog open={composeOpen} title="Publish Multi-Channel Announcement" onClose={() => setComposeOpen(false)}>
        <form onSubmit={handleBroadcast} className="space-y-4 text-sm">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Title</label>
            <input
              type="text"
              required
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Announcement Message</label>
            <textarea
              required
              rows={3}
              value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-md"
            />
          </div>
          <div>
            <span className="block text-xs font-semibold text-slate-700 mb-2">Delivery Channels</span>
            <div className="flex flex-wrap gap-3 text-xs">
              {(['IN_APP', 'EMAIL', 'SMS', 'WHATSAPP'] as const).map((ch) => (
                <label key={ch} className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.channels.includes(ch)}
                    onChange={() => toggleChannel(ch)}
                  />
                  <span className="font-mono">{ch}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setComposeOpen(false)} className="px-4 py-2 text-xs border border-slate-300 rounded-md">
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 text-xs font-semibold bg-slate-900 text-white rounded-md">
              Dispatch Announcement
            </button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
}
