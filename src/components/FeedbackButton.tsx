import { useState } from "react";
import { MessageSquareWarning } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FeedbackDialog } from "./FeedbackDialog";

export function FeedbackButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        size="sm"
        className="fixed bottom-4 end-4 z-40 shadow-lg gap-2"
      >
        <MessageSquareWarning className="h-4 w-4" />
        <span>إبلاغ عن مشكلة</span>
      </Button>
      <FeedbackDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
