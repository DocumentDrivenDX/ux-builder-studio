import { AppPage } from "./pages/AppPage";
import { HomePage } from "./pages/HomePage";
import { RunPage } from "./pages/RunPage";
import { CatalogPage } from "./pages/CatalogPage";
import { Route, Routes } from "./router";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/apps/:appId" element={<AppPage />} />
      <Route path="/run/:appId" element={<RunPage />} />
      <Route path="/catalog" element={<CatalogPage />} />
    </Routes>
  );
}
