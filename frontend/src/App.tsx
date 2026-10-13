import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { AuthGate } from "@/components/AuthGate";
import { ConsentFormPage } from "@/pages/ConsentForm";
import { NewSessionPage } from "@/pages/NewSession";
import { SessionReviewPage } from "@/pages/SessionReview";
import { SessionsPage } from "@/pages/Sessions";
import { SettingsPage } from "@/pages/Settings";

export default function App() {
  return (
    <AuthGate>
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<SessionsPage />} />
            <Route path="/new" element={<NewSessionPage />} />
            <Route path="/sessions/:id" element={<SessionReviewPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/consent-form" element={<ConsentFormPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthGate>
  );
}
