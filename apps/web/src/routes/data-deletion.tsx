import { createFileRoute } from "@tanstack/react-router";
import { DataDeletionPage } from "../components/landing/DataDeletionPage";

export const Route = createFileRoute("/data-deletion")({
  component: DataDeletionPage,
});
