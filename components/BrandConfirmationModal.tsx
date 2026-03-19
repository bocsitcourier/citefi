"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, CheckCircle2 } from "lucide-react";

interface BrandConfirmationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialBrandName: string;
  onConfirm: (confirmedBrandName: string) => void;
  title?: string;
  description?: string;
}

export function BrandConfirmationModal({
  open,
  onOpenChange,
  initialBrandName,
  onConfirm,
  title = "Confirm Company Name",
  description = "Please verify the exact spelling of your company name before generation. This cannot be changed after generation starts.",
}: BrandConfirmationModalProps) {
  const [brandName, setBrandName] = useState(initialBrandName);
  const [isConfirmed, setIsConfirmed] = useState(false);

  useEffect(() => {
    setBrandName(initialBrandName);
  }, [initialBrandName]);

  const handleConfirm = () => {
    if (brandName.trim().length === 0) {
      return;
    }
    setIsConfirmed(true);
    onConfirm(brandName.trim());
    onOpenChange(false);
    setIsConfirmed(false);
  };

  const handleCancel = () => {
    setBrandName(initialBrandName);
    setIsConfirmed(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-brand-confirmation">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-primary" />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="brand-name">Company Name</Label>
            <Input
              id="brand-name"
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              placeholder="Enter exact company name"
              className="font-semibold text-lg"
              data-testid="input-brand-name"
            />
            <p className="text-xs text-muted-foreground">
              This exact spelling will be used in all generated content (articles, images, audio, videos).
            </p>
          </div>

          <div className="bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-900 rounded-lg p-3">
            <div className="flex gap-2">
              <AlertCircle className="h-4 w-4 text-yellow-600 dark:text-yellow-500 mt-0.5 flex-shrink-0" />
              <div className="text-xs text-yellow-800 dark:text-yellow-300">
                <strong>Important:</strong> AI models will use this EXACT spelling across all generated content.
                Double-check for typos before confirming.
              </div>
            </div>
          </div>

          {brandName.trim().length > 0 && (
            <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary mt-0.5" />
                <div className="text-sm">
                  <div className="font-medium mb-1">Preview</div>
                  <div className="text-muted-foreground">
                    All content will reference: <span className="font-semibold text-foreground">{brandName.trim()}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleCancel}
            data-testid="button-cancel-brand"
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={brandName.trim().length === 0}
            data-testid="button-confirm-brand"
          >
            Confirm & Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
