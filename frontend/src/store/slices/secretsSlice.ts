import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import { engineErrorMessage, engineErrorStatus } from '@/api/engine';
import { createSecret, deleteSecret, fetchSecrets, updateSecret } from '@/api/secrets';
import type { GatewaySecret, SecretPayload, SecretsState } from '@/types/gateway.types';

// Like the rules, the secrets live in the shared database: every change is written there and
// the list (names only, never values) is read back.

/** Why a call failed: the gateway's status (undefined if it never answered) and its own message. */
export interface SecretsRejection {
  status?: number;
  message: string;
}

type ThunkConfig = { rejectValue: SecretsRejection };

const rejection = (error: unknown): SecretsRejection => ({
  status: engineErrorStatus(error),
  message: engineErrorMessage(error),
});

export const loadSecrets = createAsyncThunk<GatewaySecret[], void, ThunkConfig>(
  'secrets/load',
  async (_, { rejectWithValue }) => {
    try {
      return await fetchSecrets();
    } catch (error) {
      return rejectWithValue(rejection(error));
    }
  },
);

interface SaveSecretArgs {
  payload: SecretPayload;
  /** The secret being changed; unset to add one. */
  existing?: GatewaySecret;
  /** The administrator's session from signing in. */
  session: string;
}

export const saveSecret = createAsyncThunk<void, SaveSecretArgs, ThunkConfig>(
  'secrets/save',
  async ({ payload, existing, session }, { dispatch, rejectWithValue }) => {
    try {
      if (existing) await updateSecret(existing.id, payload, session);
      else await createSecret(payload, session);
    } catch (error) {
      return rejectWithValue(rejection(error));
    }
    await dispatch(loadSecrets());
  },
);

export const removeSecret = createAsyncThunk<void, { secret: GatewaySecret; session: string }, ThunkConfig>(
  'secrets/remove',
  async ({ secret, session }, { dispatch, rejectWithValue }) => {
    try {
      await deleteSecret(secret.id, session);
    } catch (error) {
      return rejectWithValue(rejection(error));
    }
    await dispatch(loadSecrets());
  },
);

const initialState: SecretsState = { items: [], status: 'idle' };

const secretsSlice = createSlice({
  name: 'secrets',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(loadSecrets.pending, (state) => {
        state.status = 'loading';
      })
      .addCase(loadSecrets.fulfilled, (state, action) => {
        state.status = 'ready';
        state.items = action.payload;
      })
      .addCase(loadSecrets.rejected, (state) => {
        state.status = 'failed';
      });
  },
});

export default secretsSlice.reducer;
