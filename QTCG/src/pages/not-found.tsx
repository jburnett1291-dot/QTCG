import { Card, CardContent } from '@/components/ui/card';
import { AlertCircle } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="h-full w-full flex items-center justify-center bg-background">
      <Card className="w-full max-w-md mx-4 bg-card border-border">
        <CardContent className="pt-6">
          <div className="flex mb-4 gap-2">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <h1 className="text-2xl font-bold font-mono tracking-widest uppercase text-foreground">
              404 Unknown Route
            </h1>
          </div>

          <p className="mt-4 text-sm font-mono text-muted-foreground">
            The requested War Room sector could not be found.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
