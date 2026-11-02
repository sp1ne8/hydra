CREATE TABLE users (
  id uuid PRIMARY KEY,
  username varchar(32) NOT NULL UNIQUE,
  email varchar(254) NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role varchar(10) NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin', 'owner')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  CHECK (email = lower(email)),
  CHECK (username = lower(username))
);

CREATE UNIQUE INDEX users_single_owner ON users (role) WHERE role = 'owner';

CREATE TABLE sessions (
  token_hash char(64) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expiration ON sessions(expires_at);

CREATE TABLE account_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid REFERENCES users(id),
  target_id uuid REFERENCES users(id),
  action varchar(30) NOT NULL CHECK (action IN ('register', 'login', 'logout', 'owner_created', 'role_changed', 'password_changed')),
  previous_role varchar(10),
  new_role varchar(10),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX account_events_date ON account_events(id DESC);
CREATE INDEX users_date ON users(created_at DESC, id);

CREATE TABLE request_limits (
  key char(64) PRIMARY KEY,
  attempts integer NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE INDEX request_limits_expiration ON request_limits(expires_at);
