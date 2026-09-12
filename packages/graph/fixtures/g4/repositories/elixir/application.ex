defmodule Workspai.Application do
  use Application
  alias Workspai.Graph

  def start(_type, _args), do: {:ok, self()}
end
