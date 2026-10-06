import { configureStore } from "@reduxjs/toolkit";
import { setupListeners } from "@reduxjs/toolkit/query";
import alertsReducer from "../features/alerts/alertsSlice";
import { bankApi } from "../services/api";

export const store = configureStore({
  reducer: {
    alertsUi: alertsReducer,
    [bankApi.reducerPath]: bankApi.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(bankApi.middleware),
});

setupListeners(store.dispatch);

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
