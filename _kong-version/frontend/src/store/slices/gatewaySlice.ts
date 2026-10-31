import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import { deleteRule, fetchRules, saveRule } from '@/api/kong';
import { kongErrorMessage } from '@/api/kongAdmin';
import type { GatewayRule, GatewayRulePayload, GatewayState } from '@/types/gateway.types';

// The rules live in Kong, not in the browser: every change is written there
// and the list is read back, so the page always shows what the gateway runs.

// Rejections carry Kong's message ('' when it gave none).
type ThunkConfig = { rejectValue: string };

export const loadRules = createAsyncThunk<GatewayRule[], void, ThunkConfig>(
  'gateway/loadRules',
  async (_, { rejectWithValue }) => {
    try {
      return await fetchRules();
    } catch (error) {
      return rejectWithValue(kongErrorMessage(error));
    }
  },
);

export const saveGatewayRule = createAsyncThunk<
  void,
  { payload: GatewayRulePayload; projectId: string; existing?: GatewayRule },
  ThunkConfig
>('gateway/saveRule', async ({ payload, projectId, existing }, { dispatch, rejectWithValue }) => {
  try {
    await saveRule(payload, projectId, existing);
  } catch (error) {
    return rejectWithValue(kongErrorMessage(error));
  }
  await dispatch(loadRules());
});

export const removeGatewayRule = createAsyncThunk<void, GatewayRule, ThunkConfig>(
  'gateway/removeRule',
  async (rule, { dispatch, rejectWithValue }) => {
    try {
      await deleteRule(rule);
    } catch (error) {
      return rejectWithValue(kongErrorMessage(error));
    } finally {
      // Also after a failure: part of the rule may be gone already.
      await dispatch(loadRules());
    }
  },
);

const initialState: GatewayState = { items: [], status: 'idle' };

const gatewaySlice = createSlice({
  name: 'gateway',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(loadRules.pending, (state) => {
        state.status = 'loading';
      })
      .addCase(loadRules.fulfilled, (state, action) => {
        state.status = 'ready';
        state.items = action.payload;
        state.error = undefined;
      })
      .addCase(loadRules.rejected, (state, action) => {
        state.status = 'failed';
        state.error = action.payload || undefined;
      });
  },
});

export default gatewaySlice.reducer;
