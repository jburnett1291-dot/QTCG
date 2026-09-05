import { type ReactNode, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import AccessScreen from '@/pages/access';
import WarRoomLayout from '@/pages/war-room';
import { TopNav } from '@/components/top-nav';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    }
  }
});

function SessionManager() {
  useEffect(() => {
    const url = new URL(window.location.href);
    const sessionParam = url.searchParams.get('session');
    const hashParams = new URLSearchParams(url.hash.slice(1));
    const hashSession = hashParams.get('session');
    
    const token = sessionParam || hashSession;
    if (token) {
      localStorage.setItem('qcl-session', token);
      if (sessionParam) url.searchParams.delete('session');
      if (hashSession) {
        hashParams.delete('session');
        url.hash = hashParams.toString();
      }
      window.history.replaceState({}, '', url.toString());
    }
  }, []);
  return null;
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <SessionManager />
      <div className="flex flex-col h-[100dvh] w-screen overflow-hidden bg-background text-foreground">
        <TopNav />
        <div className="flex-1 overflow-hidden relative">
          <Switch>
            <Route path="/" component={AccessScreen} />
            <Route path="/war-room">{() => <WarRoomLayout />}</Route>
            <Route path="/coach" component={() => <WarRoomLayout forceMode="coach" />} />
            <Route path="/director" component={() => <WarRoomLayout forceMode="director" />} />
            <Route component={NotFound} />
          </Switch>
        </div>
      </div>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  const configuredBase = import.meta.env.BASE_URL?.replace(/\/$/, '') || '';
  const basePath = window.location.pathname.startsWith('/warroom')
    ? '/warroom'
    : (configuredBase.startsWith('.') ? '' : configuredBase);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={basePath}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
