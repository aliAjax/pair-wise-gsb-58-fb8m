import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { AlertFilters, RiskLevel } from "../../models/types";

interface AlertsUiState {
  filters: AlertFilters;
  selectedAlertIds: string[];
  caseTargetId: string;
  focusedEvidenceId?: string;
  focusedTimelineId?: string;
  selectedNodeId?: string;
}

const initialState: AlertsUiState = {
  filters: {
    keyword: "",
    riskLevel: "all",
    status: "all",
    channel: "",
  },
  selectedAlertIds: [],
  caseTargetId: "CASE-2026-017",
};

const alertsSlice = createSlice({
  name: "alertsUi",
  initialState,
  reducers: {
    setAlertFilters(state, action: PayloadAction<Partial<AlertFilters>>) {
      state.filters = { ...state.filters, ...action.payload };
    },
    resetAlertFilters(state) {
      state.filters = initialState.filters;
    },
    toggleAlertSelection(state, action: PayloadAction<string>) {
      state.selectedAlertIds = state.selectedAlertIds.includes(action.payload)
        ? state.selectedAlertIds.filter((id) => id !== action.payload)
        : [...state.selectedAlertIds, action.payload];
    },
    setAlertSelection(state, action: PayloadAction<string[]>) {
      state.selectedAlertIds = action.payload;
    },
    setCaseTargetId(state, action: PayloadAction<string>) {
      state.caseTargetId = action.payload;
    },
    focusEvidence(state, action: PayloadAction<string | undefined>) {
      state.focusedEvidenceId = action.payload;
    },
    focusTimeline(state, action: PayloadAction<string | undefined>) {
      state.focusedTimelineId = action.payload;
    },
    selectNode(state, action: PayloadAction<string | undefined>) {
      state.selectedNodeId = action.payload;
    },
    setRiskFilter(state, action: PayloadAction<RiskLevel | "all">) {
      state.filters.riskLevel = action.payload;
    },
  },
});

export const {
  focusEvidence,
  focusTimeline,
  resetAlertFilters,
  selectNode,
  setAlertFilters,
  setAlertSelection,
  setCaseTargetId,
  setRiskFilter,
  toggleAlertSelection,
} = alertsSlice.actions;

export default alertsSlice.reducer;
