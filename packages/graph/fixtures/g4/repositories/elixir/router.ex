defmodule Workspai.Router do
  use Phoenix.Router

  get "/health", Workspai.HealthController, :show
end
