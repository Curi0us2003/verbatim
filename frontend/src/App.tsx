import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { NewSessionPage } from "@/pages/NewSession";
import { SessionReviewPage } from "@/pages/SessionReview";
import { SessionsPage } from "@/pages/Sessions";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<SessionsPage />} />
          <Route path="/new" element={<NewSessionPage />} />
          <Route path="/sessions/:id" element={<SessionReviewPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
