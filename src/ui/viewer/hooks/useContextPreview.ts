import { useState, useEffect, useCallback, useRef } from 'react';
import type { ProjectCatalog, Settings } from '../types';

interface UseContextPreviewResult {
  preview: string;
  isLoading: boolean;
  error: string | null;
  projects: string[];
  sources: string[];
  selectedSource: string | null;
  setSelectedSource: (source: string) => void;
  selectedProject: string | null;
  setSelectedProject: (project: string | null) => void;
}

function getPreferredSource(sources: string[]): string | null {
  if (sources.includes('claude')) return 'claude';
  if (sources.includes('codex')) return 'codex';
  return sources[0] || null;
}

function withDefaultSources(sources: string[]): string[] {
  const merged = ['claude', 'codex', ...sources];
  return Array.from(new Set(merged));
}

export function useContextPreview(settings: Settings): UseContextPreviewResult {
  const [preview, setPreview] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<ProjectCatalog>({ projects: [], sources: [], projectsBySource: {} });
  const [projects, setProjects] = useState<string[]>([]);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);

  // Refs keep the latest values visible inside effect closures, so the
  // preview fetch uses the project the user actually picked and is not
  // clobbered by the catalog-sync effect's own setState.
  const projectRef = useRef<string | null>(null);
  const sourceRef = useRef<string | null>(null);
  const settingsRef = useRef(settings);

  useEffect(() => { settingsRef.current = settings; }, [settings]);

  useEffect(() => {
    async function fetchProjects() {
      let data: ProjectCatalog;
      try {
        const response = await fetch('/api/projects');
        data = await response.json() as ProjectCatalog;
      } catch (err: unknown) {
        console.error('Failed to fetch projects:', err instanceof Error ? err.message : String(err));
        return;
      }
      const nextCatalog: ProjectCatalog = {
        projects: data.projects || [],
        sources: withDefaultSources(data.sources || []),
        projectsBySource: data.projectsBySource || {}
      };
      setCatalog(nextCatalog);
      const preferredSource = getPreferredSource(nextCatalog.sources);
      setSelectedSource(preferredSource);
      if (preferredSource) {
        const sourceProjects = nextCatalog.projectsBySource[preferredSource] || [];
        setProjects(sourceProjects);
        setSelectedProject(sourceProjects[0] || null);
        return;
      }
      setProjects(nextCatalog.projects);
      setSelectedProject(nextCatalog.projects[0] || null);
    }
    fetchProjects();
  }, []);

  useEffect(() => {
    if (!selectedSource) {
      setProjects(catalog.projects);
      setSelectedProject(prev => (prev && catalog.projects.includes(prev) ? prev : catalog.projects[0] || null));
      return;
    }
    const sourceProjects = catalog.projectsBySource[selectedSource] || [];
    setProjects(sourceProjects);
    setSelectedProject(prev => (prev && sourceProjects.includes(prev) ? prev : sourceProjects[0] || null));
  }, [catalog, selectedSource]);

  const doRefresh = useCallback(() => {
    const p = projectRef.current;
    if (!p) {
      setPreview('No project selected');
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    const params = new URLSearchParams({ project: p });
    if (sourceRef.current) params.append('platformSource', sourceRef.current);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/context/preview?${params}`, { signal: controller.signal })
        .then(async resp => {
          const text = await resp.text();
          if (resp.ok) { setPreview(text); setError(null); }
          else { setPreview(''); setError('Failed to load preview'); }
        })
        .catch(() => { setPreview(''); setError('Failed to load preview'); })
        .finally(() => { setIsLoading(false); });
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, []);

  useEffect(() => {
    projectRef.current = selectedProject;
    return doRefresh();
  }, [selectedProject, selectedSource, settings]);

  useEffect(() => { sourceRef.current = selectedSource; }, [selectedSource]);

  const handleSetProject = useCallback((project: string | null) => {
    setSelectedProject(project);
  }, []);

  return {
    preview,
    isLoading,
    error,
    projects,
    sources: catalog.sources,
    selectedSource,
    setSelectedSource,
    selectedProject,
    setSelectedProject: handleSetProject
  };
}
