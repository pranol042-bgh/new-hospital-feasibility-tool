import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import NewHospitalApp from "./App.jsx";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <NewHospitalApp />
  </StrictMode>,
);
