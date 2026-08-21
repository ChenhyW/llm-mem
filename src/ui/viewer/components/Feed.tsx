import React, { useMemo, useRef, useEffect, useState } from 'react';
import { Observation, Summary, UserPrompt, FeedItem } from '../types';
import { ObservationCard } from './ObservationCard';
import { SummaryCard } from './SummaryCard';
import { PromptCard } from './PromptCard';
import { ScrollToTop } from './ScrollToTop';
import { UI } from '../constants/ui';

interface FeedProps {
  observations: Observation[];
  summaries: Summary[];
  prompts: UserPrompt[];
  onLoadMore: () => void;
  isLoading: boolean;
  hasMore: boolean;
}

export function Feed({ observations, summaries, prompts, onLoadMore, isLoading, hasMore }: FeedProps) {
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const onLoadMoreRef = useRef(onLoadMore);

  // Vector index stats: which observation sqlite_ids are vectorized, plus
  // per-record reasons for those that failed to vectorize.
  const [vectorStats, setVectorStats] = useState<{ indexed_ids: number[]; model: string; unindexed_errors: Record<string, string> } | null>(null);
  useEffect(() => {
    fetch('/api/vector/stats')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) setVectorStats({
          indexed_ids: d.indexed_ids || [],
          model: d.model || 'unknown',
          unindexed_errors: d.unindexed_errors || {}
        });
      })
      .catch(() => {});
  }, [observations.length]);

  useEffect(() => {
    onLoadMoreRef.current = onLoadMore;
  }, [onLoadMore]);

  useEffect(() => {
    const element = loadMoreRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (first.isIntersecting && hasMore && !isLoading) {
          onLoadMoreRef.current?.();
        }
      },
      { threshold: UI.LOAD_MORE_THRESHOLD }
    );

    observer.observe(element);

    return () => {
      if (element) {
        observer.unobserve(element);
      }
      observer.disconnect();
    };
  }, [hasMore, isLoading]);

  const items = useMemo<FeedItem[]>(() => {
    const combined = [
      ...observations.map(o => ({ ...o, itemType: 'observation' as const })),
      ...summaries.map(s => ({ ...s, itemType: 'summary' as const })),
      ...prompts.map(p => ({ ...p, itemType: 'prompt' as const }))
    ];

    return combined.sort((a, b) => b.created_at_epoch - a.created_at_epoch);
  }, [observations, summaries, prompts]);

  // Map each observation to its real output-position within its LLM batch.
  // Observations produced by the same storeObservations call share
  // (memory_session_id, prompt_number, created_at_epoch), so we use that
  // triple as the batch boundary. Within the group, we sort by the legacy
  // batch_index + sqlite id to keep badge order stable; the fallback to
  // `batch_index` alone is imperfect (multiple LLM calls can all emit index 1),
  // which is why we group by timestamp first.
  const batchPositionByObsId = useMemo(() => {
    const grouped: Record<string, Observation[]> = {};
    for (const o of observations) {
      const key = `${o.memory_session_id}|${o.prompt_number ?? -1}|${o.created_at_epoch}`;
      (grouped[key] ??= []).push(o);
    }
    const map: Record<number, { pos: number; total: number }> = {};
    for (const key of Object.keys(grouped)) {
      const group = grouped[key];
      const sorted = [...group].sort(
        (a, b) => ((a.batch_index ?? 1) - (b.batch_index ?? 1)) || (a.id - b.id)
      );
      sorted.forEach((o, idx) => {
        map[o.id] = { pos: idx + 1, total: sorted.length };
      });
    }
    return map;
  }, [observations]);

  return (
    <div className="feed" ref={feedRef}>
      <ScrollToTop targetRef={feedRef} />
      <div className="feed-content">
        {items.map(item => {
          const key = `${item.itemType}-${item.id}`;
          if (item.itemType === 'observation') {
            return <ObservationCard key={key} observation={item} vectorizedIds={vectorStats?.indexed_ids} vectorModel={vectorStats?.model} unindexedErrors={vectorStats?.unindexed_errors} batchPosition={batchPositionByObsId[item.id] ?? null} />;
          } else if (item.itemType === 'summary') {
            return <SummaryCard key={key} summary={item} />;
          } else {
            return <PromptCard key={key} prompt={item} />;
          }
        })}
        {items.length === 0 && !isLoading && (
          <div style={{ textAlign: 'center', padding: '40px', color: '#8b949e' }}>
            No items to display
          </div>
        )}
        {isLoading && (
          <div style={{ textAlign: 'center', padding: '20px', color: '#8b949e' }}>
            <div className="spinner" style={{ display: 'inline-block', marginRight: '10px' }}></div>
            Loading more...
          </div>
        )}
        {hasMore && !isLoading && items.length > 0 && (
          <div ref={loadMoreRef} style={{ height: '20px', margin: '10px 0' }} />
        )}
        {!hasMore && items.length > 0 && (
          <div style={{ textAlign: 'center', padding: '20px', color: '#8b949e', fontSize: '14px' }}>
            No more items to load
          </div>
        )}
      </div>
    </div>
  );
}
