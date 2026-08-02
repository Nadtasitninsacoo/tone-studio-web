import { RecorderDashboard } from '@/components/recorder/RecorderDashboard';

/**
 * Dashboard route.
 *
 * Stays a Server Component so the shell can later fetch project metadata from the
 * NestJS API; all interactivity (Web Audio, device access) lives inside the
 * client-side <RecorderDashboard />.
 */
export default function Home() {
  return <RecorderDashboard projectName="Untitled Session" />;
}
