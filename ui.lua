if (game:GetService("CoreGui")):FindFirstChild("SaturnHub") and (game:GetService("CoreGui")):FindFirstChild("ScreenGui") then
	(game:GetService("CoreGui")).SaturnHub:Destroy();
	(game:GetService("CoreGui")).ScreenGui:Destroy();
end;
_G.Primary = Color3.fromRGB(100, 100, 100);
_G.Dark = Color3.fromRGB(22, 22, 26);
_G.Third = Color3.fromRGB(255, 255, 255);  -- branco (antes era vermelho)
function CreateRounded(Parent, Size)
	local Rounded = Instance.new("UICorner");
	Rounded.Name = "Rounded";
	Rounded.Parent = Parent;
	Rounded.CornerRadius = UDim.new(0, Size);
end;
local UserInputService = game:GetService("UserInputService");
local TweenService = game:GetService("TweenService");
function MakeDraggable(topbarobject, object)
	local Dragging = nil
	local DragInput = nil
	local DragStart = nil
	local StartPosition = nil

	local function Update(input)
		local Delta = input.Position - DragStart
		object.Position = UDim2.new(
			StartPosition.X.Scale, StartPosition.X.Offset + Delta.X,
			StartPosition.Y.Scale, StartPosition.Y.Offset + Delta.Y
		)
	end

	topbarobject.InputBegan:Connect(function(input)
		if input.UserInputType == Enum.UserInputType.MouseButton1 or input.UserInputType == Enum.UserInputType.Touch then
			Dragging = true
			DragStart = input.Position
			StartPosition = object.Position
			input.Changed:Connect(function()
				if input.UserInputState == Enum.UserInputState.End then
					Dragging = false
				end
			end)
		end
	end)

	topbarobject.InputChanged:Connect(function(input)
		if input.UserInputType == Enum.UserInputType.MouseMovement or input.UserInputType == Enum.UserInputType.Touch then
			DragInput = input
		end
	end)

	UserInputService.InputChanged:Connect(function(input)
		if input == DragInput and Dragging then
			Update(input)
		end
	end)
end
local ScreenGui = Instance.new("ScreenGui");
ScreenGui.Parent = game.CoreGui;
ScreenGui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling;
local OutlineButton = Instance.new("Frame");
OutlineButton.Name = "OutlineButton";
OutlineButton.Parent = ScreenGui;
OutlineButton.ClipsDescendants = true;
OutlineButton.BackgroundColor3 = _G.Dark;
OutlineButton.BackgroundTransparency = 0;
OutlineButton.Position = UDim2.new(0, 10, 0, 10);
OutlineButton.Size = UDim2.new(0, 50, 0, 50);
CreateRounded(OutlineButton, 12);
local ImageButton = Instance.new("ImageButton");
ImageButton.Parent = OutlineButton;
ImageButton.Position = UDim2.new(0.5, 0, 0.5, 0);
ImageButton.Size = UDim2.new(0, 40, 0, 40);
ImageButton.AnchorPoint = Vector2.new(0.5, 0.5);
ImageButton.BackgroundColor3 = _G.Dark;
ImageButton.ImageColor3 = Color3.fromRGB(250, 250, 250);
ImageButton.ImageTransparency = 0;
ImageButton.BackgroundTransparency = 0;
ImageButton.Image = "rbxassetid://115881950720740";
ImageButton.AutoButtonColor = false;
MakeDraggable(ImageButton, OutlineButton);
CreateRounded(ImageButton, 10);
ImageButton.MouseButton1Click:connect(function()
	(game.CoreGui:FindFirstChild("SaturnHub")).Enabled = not (game.CoreGui:FindFirstChild("SaturnHub")).Enabled;
end);
local NotificationFrame = Instance.new("ScreenGui");
NotificationFrame.Name = "NotificationFrame";
NotificationFrame.Parent = game.CoreGui;
NotificationFrame.ZIndexBehavior = Enum.ZIndexBehavior.Global;
local NotificationList = {};
local function RemoveOldestNotification()
	if #NotificationList > 0 then
		local removed = table.remove(NotificationList, 1);
		removed[1]:TweenPosition(UDim2.new(0.5, 0, -0.2, 0), "Out", "Quad", 0.4, true, function()
			removed[1]:Destroy();
		end);
	end;
end;
task.spawn(function()
    while true do
        task.wait(0.5)
        if #NotificationList > 0 then
            local Oldest = NotificationList[1]
            Oldest[3] = (Oldest[3] or 0) + 0.5
            if Oldest[3] >= (Oldest[2] or 3) then
                RemoveOldestNotification()
            end
        end
    end
end)
local Update = {};
function Update:Notify(config)
    local TitleText, DescText, Duration
    if type(config) == "table" then
        TitleText = config.Title or "Saturn Hub"
        DescText = config.Description or ""
        Duration = config.Duration or 3
    else
        TitleText = "Saturn Hub"
        DescText = tostring(config)
        Duration = 3
    end

    local OutlineFrame = Instance.new("Frame")
    local Frame = Instance.new("Frame")
    local Image = Instance.new("ImageLabel")
    local TitleLabel = Instance.new("TextLabel")
    local DescLabel = Instance.new("TextLabel")

    OutlineFrame.Name = "OutlineFrame"
    OutlineFrame.Parent = NotificationFrame
    OutlineFrame.ClipsDescendants = true
    OutlineFrame.BackgroundColor3 = Color3.fromRGB(30, 30, 30)
    OutlineFrame.AnchorPoint = Vector2.new(0.5, 1)
    OutlineFrame.BackgroundTransparency = 0.4
    OutlineFrame.Position = UDim2.new(0.5, 0, -0.2, 0)
    OutlineFrame.Size = UDim2.new(0, 412, 0, 72)
    CreateRounded(OutlineFrame, 12)

    Frame.Name = "Frame"
    Frame.Parent = OutlineFrame
    Frame.ClipsDescendants = true
    Frame.AnchorPoint = Vector2.new(0.5, 0.5)
    Frame.BackgroundColor3 = _G.Dark
    Frame.BackgroundTransparency = 0.1
    Frame.Position = UDim2.new(0.5, 0, 0.5, 0)
    Frame.Size = UDim2.new(0, 400, 0, 60)
    CreateRounded(Frame, 10)

    Image.Name = "Icon"
    Image.Parent = Frame
    Image.BackgroundColor3 = Color3.fromRGB(255, 255, 255)
    Image.BackgroundTransparency = 1
    Image.Position = UDim2.new(0, 8, 0, 8)
    Image.Size = UDim2.new(0, 45, 0, 45)
    Image.Image = "rbxassetid://13940080072"

    TitleLabel.Parent = Frame
    TitleLabel.BackgroundTransparency = 1
    TitleLabel.Position = UDim2.new(0, 55, 0, 14)
    TitleLabel.Size = UDim2.new(1, -65, 0, 20)
    TitleLabel.Font = Enum.Font.GothamBold
    TitleLabel.Text = TitleText
    TitleLabel.TextColor3 = Color3.fromRGB(255, 255, 255)
    TitleLabel.TextSize = 16
    TitleLabel.TextXAlignment = Enum.TextXAlignment.Left

    DescLabel.Parent = Frame
    DescLabel.BackgroundTransparency = 1
    DescLabel.Position = UDim2.new(0, 55, 0, 33)
    DescLabel.Size = UDim2.new(1, -65, 0, 20)
    DescLabel.Font = Enum.Font.GothamSemibold
    DescLabel.TextTransparency = 0.3
    DescLabel.Text = DescText
    DescLabel.TextColor3 = Color3.fromRGB(255, 255, 255)
    DescLabel.TextSize = 12
    DescLabel.TextXAlignment = Enum.TextXAlignment.Left

    OutlineFrame:TweenPosition(UDim2.new(0.5, 0, 0.1 + (#NotificationList) * 0.1, 0), "Out", "Quad", 0.4, true)
    table.insert(NotificationList, {OutlineFrame, Duration, 0})
end;

local SettingsLib = {
	SaveSettings = true,
	LoadAnimation = true
};
(getgenv()).LoadConfig = function()
	if readfile and writefile and isfile and isfolder then
		if not isfolder("SaturnHub") then
			makefolder("SaturnHub");
		end;
		if not isfolder("SaturnHub/Library/") then
			makefolder("SaturnHub/Library/");
		end;
		if not isfile(("SaturnHub/Library/" .. game.Players.LocalPlayer.Name .. ".json")) then
			writefile("SaturnHub/Library/" .. game.Players.LocalPlayer.Name .. ".json", (game:GetService("HttpService")):JSONEncode(SettingsLib));
		else
			local Decode = (game:GetService("HttpService")):JSONDecode(readfile("SaturnHub/Library/" .. game.Players.LocalPlayer.Name .. ".json"));
			for i, v in pairs(Decode) do
				SettingsLib[i] = v;
			end;
		end;
		print("Library Loaded!");
	else
		return warn("Status : Undetected Executor");
	end;
end;
(getgenv()).SaveConfig = function()
	if readfile and writefile and isfile and isfolder then
		if not isfile(("SaturnHub/Library/" .. game.Players.LocalPlayer.Name .. ".json")) then
			(getgenv()).Load();
		else
			local Decode = (game:GetService("HttpService")):JSONDecode(readfile("SaturnHub/Library/" .. game.Players.LocalPlayer.Name .. ".json"));
			local Array = {};
			for i, v in pairs(SettingsLib) do
				Array[i] = v;
			end;
			writefile("SaturnHub/Library/" .. game.Players.LocalPlayer.Name .. ".json", (game:GetService("HttpService")):JSONEncode(Array));
		end;
	else
		return warn("Status : Undetected Executor");
	end;
end;
(getgenv()).LoadConfig();
function Update:SaveSettings()
	if SettingsLib.SaveSettings then
		return true;
	end;
	return false;
end;
function Update:LoadAnimation()
	if SettingsLib.LoadAnimation then
		return true;
	end;
	return false;
end;
function Update:Window(Config)
	assert(Config.SubTitle, "by satn01");
	local WindowConfig = {
		Size = Config.Size,
		TabWidth = Config.TabWidth
	};
	local osfunc = {};
local uihide = false;
local abc = false;
local currentpage = "";
local keybind = keybind or Enum.KeyCode.RightControl;
local yoo = string.gsub(tostring(keybind), "Enum.KeyCode.", "");
local SaturnHub = Instance.new("ScreenGui");
SaturnHub.Name = "SaturnHub";
SaturnHub.Parent = game.CoreGui;
SaturnHub.DisplayOrder = 999;
local OutlineMain = Instance.new("Frame");
OutlineMain.Name = "OutlineMain";
OutlineMain.Parent = SaturnHub;
OutlineMain.ClipsDescendants = true;
OutlineMain.AnchorPoint = Vector2.new(0.5, 0.5);
OutlineMain.BackgroundColor3 = Color3.fromRGB(30, 30, 30);
OutlineMain.BackgroundTransparency = 0.4;
OutlineMain.Position = UDim2.new(0.5, 0, 0.45, 0);
OutlineMain.Size = UDim2.new(0, 0, 0, 0);
CreateRounded(OutlineMain, 15);
local Main = Instance.new("Frame");
Main.Name = "Main";
Main.Parent = OutlineMain;
Main.ClipsDescendants = true;
Main.AnchorPoint = Vector2.new(0.5, 0.5);
Main.BackgroundColor3 = Color3.fromRGB(24, 24, 26);
Main.BackgroundTransparency = 0;
Main.Position = UDim2.new(0.5, 0, 0.5, 0);
Main.Size = WindowConfig.Size;
OutlineMain:TweenSize(UDim2.new(0, WindowConfig.Size.X.Offset + 15, 0, WindowConfig.Size.Y.Offset + 15), "Out", "Quad", 0.4, true);
CreateRounded(Main, 12);
local BtnStroke = Instance.new("UIStroke");
local DragButton = Instance.new("Frame");
DragButton.Name = "DragButton";
DragButton.Parent = Main;
DragButton.Position = UDim2.new(1, 5, 1, 5);
DragButton.AnchorPoint = Vector2.new(1, 1);
DragButton.Size = UDim2.new(0, 15, 0, 15);
DragButton.BackgroundColor3 = Color3.fromRGB(255, 255, 255);  -- branco
DragButton.BackgroundTransparency = 1;
DragButton.ZIndex = 10;
local mouse = game.Players.LocalPlayer:GetMouse();
local uis = game:GetService("UserInputService");
local CircleDragButton = Instance.new("UICorner");
CircleDragButton.Name = "CircleDragButton";
CircleDragButton.Parent = DragButton;
CircleDragButton.CornerRadius = UDim.new(0, 99);
local Top = Instance.new("Frame");
Top.Name = "Top";
Top.Parent = Main;
Top.BackgroundColor3 = Color3.fromRGB(10, 10, 10);
Top.Size = UDim2.new(1, 0, 0, 52);  -- aumentado para caber título + subtítulo empilhados
Top.BackgroundTransparency = 1;
CreateRounded(Top, 5);
local NameHub = Instance.new("TextLabel");
NameHub.Name = "NameHub";
NameHub.Parent = Top;
NameHub.BackgroundColor3 = Color3.fromRGB(255, 255, 255);
NameHub.BackgroundTransparency = 1;
NameHub.RichText = true;
NameHub.Position = UDim2.new(0, 15, 0, 8);  -- posicionado mais acima
NameHub.AnchorPoint = Vector2.new(0, 0);
NameHub.Size = UDim2.new(0, 1, 0, 20);
NameHub.Font = Enum.Font.GothamBold;
NameHub.Text = "Saturn Hub";
NameHub.TextSize = 18;
NameHub.TextColor3 = Color3.fromRGB(255, 255, 255);
NameHub.TextXAlignment = Enum.TextXAlignment.Left;
local nameHubSize = (game:GetService("TextService")):GetTextSize(NameHub.Text, NameHub.TextSize, NameHub.Font, Vector2.new(math.huge, math.huge));
NameHub.Size = UDim2.new(0, nameHubSize.X, 0, 20);
local SubTitle = Instance.new("TextLabel");
SubTitle.Name = "SubTitle";
SubTitle.Parent = Top;  -- agora é filho direto de Top, não de NameHub
SubTitle.BackgroundColor3 = Color3.fromRGB(255, 255, 255);
SubTitle.BackgroundTransparency = 1;
SubTitle.Position = UDim2.new(0, 15, 0, 28);  -- abaixo do título
SubTitle.Size = UDim2.new(0, 1, 0, 16);
SubTitle.Font = Enum.Font.Gotham;
SubTitle.AnchorPoint = Vector2.new(0, 0);
SubTitle.Text = Config.SubTitle;
SubTitle.TextSize = 13;
SubTitle.TextColor3 = Color3.fromRGB(200, 200, 200);  -- cinza claro
SubTitle.TextXAlignment = Enum.TextXAlignment.Left;
local SubTitleSize = (game:GetService("TextService")):GetTextSize(SubTitle.Text, SubTitle.TextSize, SubTitle.Font, Vector2.new(math.huge, math.huge));
SubTitle.Size = UDim2.new(0, SubTitleSize.X, 0, 16);
local CloseButton = Instance.new("ImageButton");
CloseButton.Name = "CloseButton";
CloseButton.Parent = Top;
CloseButton.BackgroundColor3 = Color3.fromRGB(255, 255, 255);  -- branco
CloseButton.BackgroundTransparency = 1;
CloseButton.AnchorPoint = Vector2.new(1, 0.5);
CloseButton.Position = UDim2.new(1, -15, 0.5, 0);
CloseButton.Size = UDim2.new(0, 20, 0, 20);
CloseButton.Image = "rbxassetid://7743878857";
CloseButton.ImageTransparency = 0;
CloseButton.ImageColor3 = Color3.fromRGB(245, 245, 245);
CreateRounded(CloseButton, 3);
CloseButton.MouseButton1Click:connect(function()
    (game.CoreGui:FindFirstChild("SaturnHub")).Enabled = not (game.CoreGui:FindFirstChild("SaturnHub")).Enabled;
end);
local ResizeButton = Instance.new("ImageButton");
ResizeButton.Name = "ResizeButton";
ResizeButton.Parent = Top;
ResizeButton.BackgroundColor3 = Color3.fromRGB(255, 255, 255);  -- branco
ResizeButton.BackgroundTransparency = 1;
ResizeButton.AnchorPoint = Vector2.new(1, 0.5);
ResizeButton.Position = UDim2.new(1, -50, 0.5, 0);
ResizeButton.Size = UDim2.new(0, 20, 0, 20);
ResizeButton.Image = "rbxassetid://10734886735";
ResizeButton.ImageTransparency = 0;
ResizeButton.ImageColor3 = Color3.fromRGB(245, 245, 245);
CreateRounded(ResizeButton, 3);
local BackgroundSettings = Instance.new("Frame");
BackgroundSettings.Name = "BackgroundSettings";
BackgroundSettings.Parent = OutlineMain;
BackgroundSettings.ClipsDescendants = true;
BackgroundSettings.Active = true;
BackgroundSettings.AnchorPoint = Vector2.new(0, 0);
BackgroundSettings.BackgroundColor3 = Color3.fromRGB(10, 10, 10);
BackgroundSettings.BackgroundTransparency = 0.3;
BackgroundSettings.Position = UDim2.new(0, 0, 0, 0);
BackgroundSettings.Size = UDim2.new(1, 0, 1, 0);
BackgroundSettings.Visible = false;
CreateRounded(BackgroundSettings, 15);
local SettingsFrame = Instance.new("Frame");
SettingsFrame.Name = "SettingsFrame";
SettingsFrame.Parent = BackgroundSettings;
SettingsFrame.ClipsDescendants = true;
SettingsFrame.AnchorPoint = Vector2.new(0.5, 0.5);
SettingsFrame.BackgroundColor3 = Color3.fromRGB(24, 24, 26);
SettingsFrame.BackgroundTransparency = 0;
SettingsFrame.Position = UDim2.new(0.5, 0, 0.5, 0);
SettingsFrame.Size = UDim2.new(0.7, 0, 0.7, 0);
CreateRounded(SettingsFrame, 15);
local CloseSettings = Instance.new("ImageButton");
CloseSettings.Name = "CloseSettings";
CloseSettings.Parent = SettingsFrame;
CloseSettings.BackgroundColor3 = Color3.fromRGB(255, 255, 255);  -- branco
CloseSettings.BackgroundTransparency = 1;
CloseSettings.AnchorPoint = Vector2.new(1, 0);
CloseSettings.Position = UDim2.new(1, -20, 0, 15);
CloseSettings.Size = UDim2.new(0, 20, 0, 20);
CloseSettings.Image = "rbxassetid://10747384394";
CloseSettings.ImageTransparency = 0;
CloseSettings.ImageColor3 = Color3.fromRGB(245, 245, 245);
CreateRounded(CloseSettings, 3);
CloseSettings.MouseButton1Click:connect(function()
    BackgroundSettings.Visible = false;
end);
local SettingsButton = Instance.new("ImageButton");
SettingsButton.Name = "SettingsButton";
SettingsButton.Parent = Top;
SettingsButton.BackgroundColor3 = Color3.fromRGB(255, 255, 255);  -- branco
SettingsButton.BackgroundTransparency = 1;
SettingsButton.AnchorPoint = Vector2.new(1, 0.5);
SettingsButton.Position = UDim2.new(1, -85, 0.5, 0);
SettingsButton.Size = UDim2.new(0, 20, 0, 20);
SettingsButton.Image = "rbxassetid://10734950020";
SettingsButton.ImageTransparency = 0;
SettingsButton.ImageColor3 = Color3.fromRGB(245, 245, 245);
CreateRounded(SettingsButton, 3);
SettingsButton.MouseButton1Click:connect(function()
    BackgroundSettings.Visible = true;
end);
local TitleSettings = Instance.new("TextLabel");
TitleSettings.Name = "TitleSettings";
TitleSettings.Parent = SettingsFrame;
TitleSettings.BackgroundColor3 = Color3.fromRGB(255, 255, 255);
TitleSettings.BackgroundTransparency = 1;
TitleSettings.Position = UDim2.new(0, 20, 0, 15);
TitleSettings.Size = UDim2.new(1, 0, 0, 20);
TitleSettings.Font = Enum.Font.GothamBold;
TitleSettings.AnchorPoint = Vector2.new(0, 0);
TitleSettings.Text = "Library Settings";
TitleSettings.TextSize = 20;
TitleSettings.TextColor3 = Color3.fromRGB(245, 245, 245);
TitleSettings.TextXAlignment = Enum.TextXAlignment.Left;
local SettingsMenuList = Instance.new("Frame");
SettingsMenuList.Name = "SettingsMenuList";
SettingsMenuList.Parent = SettingsFrame;
SettingsMenuList.ClipsDescendants = true;
SettingsMenuList.AnchorPoint = Vector2.new(0, 0);
SettingsMenuList.BackgroundColor3 = Color3.fromRGB(24, 24, 26);
SettingsMenuList.BackgroundTransparency = 1;
SettingsMenuList.Position = UDim2.new(0, 0, 0, 50);
SettingsMenuList.Size = UDim2.new(1, 0, 1, -70);
CreateRounded(SettingsMenuList, 15);
local ScrollSettings = Instance.new("ScrollingFrame");
ScrollSettings.Name = "ScrollSettings";
ScrollSettings.Parent = SettingsMenuList;
ScrollSettings.Active = true;
ScrollSettings.BackgroundColor3 = Color3.fromRGB(10, 10, 10);
ScrollSettings.Position = UDim2.new(0, 0, 0, 0);
ScrollSettings.BackgroundTransparency = 1;
ScrollSettings.Size = UDim2.new(1, 0, 1, 0);
ScrollSettings.ScrollBarThickness = 3;
ScrollSettings.ScrollingDirection = Enum.ScrollingDirection.Y;
CreateRounded(SettingsMenuList, 5);
local SettingsListLayout = Instance.new("UIListLayout");
SettingsListLayout.Name = "SettingsListLayout";
SettingsListLayout.Parent = ScrollSettings;
SettingsListLayout.SortOrder = Enum.SortOrder.LayoutOrder;
SettingsListLayout.Padding = UDim.new(0, 8);
local PaddingScroll = Instance.new("UIPadding");
PaddingScroll.Name = "PaddingScroll";
PaddingScroll.Parent = ScrollSettings;
function CreateCheckbox(title, state, callback)
    local checked = state or false;
    local Background = Instance.new("Frame");
    Background.Name = "Background";
    Background.Parent = ScrollSettings;
    Background.ClipsDescendants = true;
    Background.BackgroundColor3 = Color3.fromRGB(24, 24, 26);
    Background.BackgroundTransparency = 1;
    Background.Size = UDim2.new(1, 0, 0, 20);
    local Title = Instance.new("TextLabel");
    Title.Name = "Title";
    Title.Parent = Background;
    Title.BackgroundColor3 = Color3.fromRGB(255, 255, 255);
    Title.BackgroundTransparency = 1;
    Title.Position = UDim2.new(0, 60, 0.5, 0);
    Title.Size = UDim2.new(1, -60, 0, 20);
    Title.Font = Enum.Font.Code;
    Title.AnchorPoint = Vector2.new(0, 0.5);
    Title.Text = title or "";
    Title.TextSize = 15;
    Title.TextColor3 = Color3.fromRGB(200, 200, 200);
    Title.TextXAlignment = Enum.TextXAlignment.Left;
    local Checkbox = Instance.new("ImageButton");
    Checkbox.Name = "Checkbox";
    Checkbox.Parent = Background;
    Checkbox.BackgroundColor3 = Color3.fromRGB(100, 100, 100);
    Checkbox.BackgroundTransparency = 0;
    Checkbox.AnchorPoint = Vector2.new(0, 0.5);
    Checkbox.Position = UDim2.new(0, 30, 0.5, 0);
    Checkbox.Size = UDim2.new(0, 20, 0, 20);
    Checkbox.Image = "rbxassetid://10709790644";
    Checkbox.ImageTransparency = 1;
    Checkbox.ImageColor3 = Color3.fromRGB(245, 245, 245);
    CreateRounded(Checkbox, 5);
    Checkbox.MouseButton1Click:Connect(function()
        checked = not checked;
        if checked then
            Checkbox.ImageTransparency = 0;
            Checkbox.BackgroundColor3 = Color3.fromRGB(255, 255, 255);  -- branco
        else
            Checkbox.ImageTransparency = 1;
            Checkbox.BackgroundColor3 = Color3.fromRGB(100, 100, 100);
        end;
        pcall(callback, checked);
    end);
    if checked then
        Checkbox.ImageTransparency = 0;
        Checkbox.BackgroundColor3 = Color3.fromRGB(255, 255, 255);  -- branco
    else
        Checkbox.ImageTransparency = 1;
        Checkbox.BackgroundColor3 = Color3.fromRGB(100, 100, 100);
    end;
    pcall(callback, checked);
end;
function CreateButton(title, callback)
    local Background = Instance.new("Frame");
    Background.Name = "Background";
    Background.Parent = ScrollSettings;
    Background.ClipsDescendants = true;
    Background.BackgroundColor3 = Color3.fromRGB(24, 24, 26);
    Background.BackgroundTransparency = 1;
    Background.Size = UDim2.new(1, 0, 0, 30);
    local Button = Instance.new("TextButton");
    Button.Name = "Button";
    Button.Parent = Background;
    Button.BackgroundColor3 = Color3.fromRGB(255, 255, 255);  -- branco
    Button.BackgroundTransparency = 0;
    Button.Size = UDim2.new(0.8, 0, 0, 30);
    Button.Font = Enum.Font.Code;
    Button.Text = title or "Button";
    Button.AnchorPoint = Vector2.new(0.5, 0);
    Button.Position = UDim2.new(0.5, 0, 0, 0);
    Button.TextColor3 = Color3.fromRGB(24, 24, 26);  -- texto escuro para contraste com fundo branco
    Button.TextSize = 15;
    Button.AutoButtonColor = false;
    Button.MouseButton1Click:Connect(function()
        callback();
    end);
    CreateRounded(Button, 5);
end;
CreateCheckbox("Save Settings", SettingsLib.SaveSettings, function(state)
    SettingsLib.SaveSettings = state;
    (getgenv()).SaveConfig();
end);
CreateButton("Reset Config", function()
    if isfolder("SaturnHub") then  -- alterado para SaturnHub
        delfolder("SaturnHub");
    end;
    Update:Notify("Config has been reseted!");
end);
local Tab = Instance.new("Frame");
Tab.Name = "Tab";
Tab.Parent = Main;
Tab.BackgroundColor3 = Color3.fromRGB(45, 45, 45);
Tab.Position = UDim2.new(0, 8, 0, Top.Size.Y.Offset);
Tab.BackgroundTransparency = 1;
Tab.Size = UDim2.new(0, WindowConfig.TabWidth, Config.Size.Y.Scale, Config.Size.Y.Offset - Top.Size.Y.Offset - 8);
local BtnStroke = Instance.new("UIStroke");
local ScrollTab = Instance.new("ScrollingFrame");
ScrollTab.Name = "ScrollTab";
ScrollTab.Parent = Tab;
ScrollTab.Active = true;
ScrollTab.BackgroundColor3 = Color3.fromRGB(10, 10, 10);
ScrollTab.Position = UDim2.new(0, 0, 0, 0);
ScrollTab.BackgroundTransparency = 1;
ScrollTab.Size = UDim2.new(1, 0, 1, 0);
ScrollTab.ScrollBarThickness = 0;
ScrollTab.ScrollingDirection = Enum.ScrollingDirection.Y;
CreateRounded(Tab, 5);
local TabListLayout = Instance.new("UIListLayout");
TabListLayout.Name = "TabListLayout";
TabListLayout.Parent = ScrollTab;
TabListLayout.SortOrder = Enum.SortOrder.LayoutOrder;
TabListLayout.Padding = UDim.new(0, 2);
local PPD = Instance.new("UIPadding");
PPD.Name = "PPD";
PPD.Parent = ScrollTab;
local Page = Instance.new("Frame");
Page.Name = "Page";
Page.Parent = Main;
Page.BackgroundColor3 = _G.Dark;
Page.Position = UDim2.new(0, Tab.Size.X.Offset + 18, 0, Top.Size.Y.Offset);
Page.Size = UDim2.new(Config.Size.X.Scale, Config.Size.X.Offset - Tab.Size.X.Offset - 25, Config.Size.Y.Scale, Config.Size.Y.Offset - Top.Size.Y.Offset - 8);
Page.BackgroundTransparency = 1;
CreateRounded(Page, 3);
local MainPage = Instance.new("Frame");
MainPage.Name = "MainPage";
MainPage.Parent = Page;
MainPage.ClipsDescendants = true;
MainPage.BackgroundColor3 = Color3.fromRGB(255, 255, 255);
MainPage.BackgroundTransparency = 1;
MainPage.Size = UDim2.new(1, 0, 1, 0);
local PageList = Instance.new("Folder");
PageList.Name = "PageList";
PageList.Parent = MainPage;
local UIPageLayout = Instance.new("UIPageLayout");
UIPageLayout.Parent = PageList;
UIPageLayout.SortOrder = Enum.SortOrder.LayoutOrder;
UIPageLayout.EasingDirection = Enum.EasingDirection.InOut;
UIPageLayout.EasingStyle = Enum.EasingStyle.Quad;
UIPageLayout.FillDirection = Enum.FillDirection.Vertical;
UIPageLayout.Padding = UDim.new(0, 10);
UIPageLayout.TweenTime = 0;
UIPageLayout.GamepadInputEnabled = false;
UIPageLayout.ScrollWheelInputEnabled = false;
UIPageLayout.TouchInputEnabled = false;
MakeDraggable(Top, OutlineMain);
UserInputService.InputBegan:Connect(function(input)
    if input.KeyCode == Enum.KeyCode.Insert then
        (game.CoreGui:FindFirstChild("SaturnHub")).Enabled = not (game.CoreGui:FindFirstChild("SaturnHub")).Enabled;
    end;
end);
	local Dragging = false;
	DragButton.InputBegan:Connect(function(Input)
		if Input.UserInputType == Enum.UserInputType.MouseButton1 or Input.UserInputType == Enum.UserInputType.Touch then
			Dragging = true;
		end;
	end);
	UserInputService.InputEnded:Connect(function(Input)
		if Input.UserInputType == Enum.UserInputType.MouseButton1 or Input.UserInputType == Enum.UserInputType.Touch then
			Dragging = false;
		end;
	end);
	UserInputService.InputChanged:Connect(function(Input)
		if Dragging and (Input.UserInputType == Enum.UserInputType.MouseMovement or Input.UserInputType == Enum.UserInputType.Touch) then
			OutlineMain.Size = UDim2.new(0, math.clamp(Input.Position.X - Main.AbsolutePosition.X + 15, WindowConfig.Size.X.Offset + 15, math.huge), 0, math.clamp(Input.Position.Y - Main.AbsolutePosition.Y + 15, WindowConfig.Size.Y.Offset + 15, math.huge));
			Main.Size = UDim2.new(0, math.clamp(Input.Position.X - Main.AbsolutePosition.X, WindowConfig.Size.X.Offset, math.huge), 0, math.clamp(Input.Position.Y - Main.AbsolutePosition.Y, WindowConfig.Size.Y.Offset, math.huge));
			Page.Size = UDim2.new(0, math.clamp(Input.Position.X - Page.AbsolutePosition.X - 8, WindowConfig.Size.X.Offset - Tab.Size.X.Offset - 25, math.huge), 0, math.clamp(Input.Position.Y - Page.AbsolutePosition.Y - 8, WindowConfig.Size.Y.Offset - Top.Size.Y.Offset - 10, math.huge));
			Tab.Size = UDim2.new(0, WindowConfig.TabWidth, 0, math.clamp(Input.Position.Y - Tab.AbsolutePosition.Y - 8, WindowConfig.Size.Y.Offset - Top.Size.Y.Offset - 10, math.huge));
		end;
	end);
	local uitab = {};
	function uitab:Tab(text, img)
		local BtnStroke = Instance.new("UIStroke");
		local TabButton = Instance.new("TextButton");
		local title = Instance.new("TextLabel");
		local TUICorner = Instance.new("UICorner");
		local UICorner = Instance.new("UICorner");
		local Title = Instance.new("TextLabel");
		TabButton.Parent = ScrollTab;
		TabButton.Name = text .. "Unique";
		TabButton.Text = "";
		TabButton.BackgroundColor3 = Color3.fromRGB(100, 100, 100);
		TabButton.BackgroundTransparency = 1;
		TabButton.Size = UDim2.new(1, 0, 0, 35);
		TabButton.Font = Enum.Font.Nunito;
		TabButton.TextColor3 = Color3.fromRGB(255, 255, 255);
		TabButton.TextSize = 12;
		TabButton.TextTransparency = 0.9;
		local SelectedTab = Instance.new("Frame");
		SelectedTab.Name = "SelectedTab";
		SelectedTab.Parent = TabButton;
		SelectedTab.BackgroundColor3 = _G.Third;  -- agora branco
		SelectedTab.BackgroundTransparency = 0;
		SelectedTab.Size = UDim2.new(0, 3, 0, 0);
		SelectedTab.Position = UDim2.new(0, 0, 0.5, 0);
		SelectedTab.AnchorPoint = Vector2.new(0, 0.5);
		UICorner.CornerRadius = UDim.new(0, 100);
		UICorner.Parent = SelectedTab;
		Title.Parent = TabButton;
		Title.Name = "Title";
		Title.BackgroundColor3 = Color3.fromRGB(150, 150, 150);
		Title.BackgroundTransparency = 1;
		Title.Position = UDim2.new(0, 30, 0.5, 0);
		Title.Size = UDim2.new(0, 100, 0, 30);
		Title.Font = Enum.Font.Roboto;
		Title.Text = text;
		Title.AnchorPoint = Vector2.new(0, 0.5);
		Title.TextColor3 = Color3.fromRGB(255, 255, 255);
		Title.TextTransparency = 0.4;
		Title.TextSize = 14;
		Title.TextXAlignment = Enum.TextXAlignment.Left;
		local IDK = Instance.new("ImageLabel");
		IDK.Name = "IDK";
		IDK.Parent = TabButton;
		IDK.BackgroundColor3 = Color3.fromRGB(255, 255, 255);
		IDK.BackgroundTransparency = 1;
		IDK.ImageTransparency = 0.3;
		IDK.Position = UDim2.new(0, 7, 0.5, 0);
		IDK.Size = UDim2.new(0, 15, 0, 15);
		IDK.AnchorPoint = Vector2.new(0, 0.5);
		IDK.Image = img;
		CreateRounded(TabButton, 6);
		local MainFramePage = Instance.new("ScrollingFrame");
		MainFramePage.Name = text .. "_Page";
		MainFramePage.Parent = PageList;
		MainFramePage.Active = true;
		MainFramePage.BackgroundColor3 = _G.Dark;
		MainFramePage.Position = UDim2.new(0, 0, 0, 0);
		MainFramePage.BackgroundTransparency = 1;
		MainFramePage.Size = UDim2.new(1, 0, 1, 0);
		MainFramePage.ScrollBarThickness = 0;
		MainFramePage.ScrollingDirection = Enum.ScrollingDirection.Y;
		local zzzR = Instance.new("UICorner");
		zzzR.Parent = MainPage;
		zzzR.CornerRadius = UDim.new(0, 5);
		local UIPadding = Instance.new("UIPadding");
		local UIListLayout = Instance.new("UIListLayout");
		UIPadding.Parent = MainFramePage;
		UIListLayout.Padding = UDim.new(0, 3);
		UIListLayout.Parent = MainFramePage;
		UIListLayout.SortOrder = Enum.SortOrder.LayoutOrder;
		TabButton.MouseButton1Click:Connect(function()
			for i, v in next, ScrollTab:GetChildren() do
				if v:IsA("TextButton") then
					(TweenService:Create(v, TweenInfo.new(0.3, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
						BackgroundTransparency = 1
					})):Play();
					(TweenService:Create(v.SelectedTab, TweenInfo.new(0, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
						Size = UDim2.new(0, 3, 0, 0)
					})):Play();
					(TweenService:Create(v.IDK, TweenInfo.new(0.3, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
						ImageTransparency = 0.4
					})):Play();
					(TweenService:Create(v.Title, TweenInfo.new(0.3, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
						TextTransparency = 0.4
					})):Play();
				end;
				(TweenService:Create(TabButton, TweenInfo.new(0.3, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
					BackgroundTransparency = 0.8
				})):Play();
				(TweenService:Create(SelectedTab, TweenInfo.new(0.3, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
					Size = UDim2.new(0, 3, 0, 15)
				})):Play();
				(TweenService:Create(IDK, TweenInfo.new(0.3, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
					ImageTransparency = 0
				})):Play();
				(TweenService:Create(Title, TweenInfo.new(0.3, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
					TextTransparency = 0
				})):Play();
			end;
			for i, v in next, PageList:GetChildren() do
				currentpage = string.gsub(TabButton.Name, "Unique", "") .. "_Page";
				if v.Name == currentpage then
					UIPageLayout:JumpTo(v);
				end;
			end;
		end);
		if abc == false then
			for i, v in next, ScrollTab:GetChildren() do
				if v:IsA("TextButton") then
					(TweenService:Create(v, TweenInfo.new(0.3, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
						BackgroundTransparency = 1
					})):Play();
					(TweenService:Create(v.SelectedTab, TweenInfo.new(0.2, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
						Size = UDim2.new(0, 3, 0, 15)
					})):Play();
					(TweenService:Create(v.IDK, TweenInfo.new(0.3, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
						ImageTransparency = 0.4
					})):Play();
					(TweenService:Create(v.Title, TweenInfo.new(0.3, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
						TextTransparency = 0.4
					})):Play();
				end;
				(TweenService:Create(TabButton, TweenInfo.new(0.3, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
					BackgroundTransparency = 0.8
				})):Play();
				(TweenService:Create(SelectedTab, TweenInfo.new(0.2, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
					Size = UDim2.new(0, 3, 0, 15)
				})):Play();
				(TweenService:Create(IDK, TweenInfo.new(0.3, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
					ImageTransparency = 0
				})):Play();
				(TweenService:Create(Title, TweenInfo.new(0.3, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
					TextTransparency = 0
				})):Play();
			end;
			UIPageLayout:JumpToIndex(1);
			abc = true;
		end;
		(game:GetService("RunService")).Stepped:Connect(function()
			pcall(function()
				MainFramePage.CanvasSize = UDim2.new(0, 0, 0, UIListLayout.AbsoluteContentSize.Y);
				ScrollTab.CanvasSize = UDim2.new(0, 0, 0, TabListLayout.AbsoluteContentSize.Y);
				ScrollSettings.CanvasSize = UDim2.new(0, 0, 0, SettingsListLayout.AbsoluteContentSize.Y);
			end);
		end);
		local defaultSize = true;
		ResizeButton.MouseButton1Click:Connect(function()
			if defaultSize then
				defaultSize = false;
				OutlineMain:TweenPosition(UDim2.new(0.5, 0, 0.45, 0), "Out", "Quad", 0.2, true);
				Main:TweenSize(UDim2.new(1, 0, 1, 0), "Out", "Quad", 0.4, true, function()
					Page:TweenSize(UDim2.new(0, Main.AbsoluteSize.X - Tab.AbsoluteSize.X - 25, 0, Main.AbsoluteSize.Y - Top.AbsoluteSize.Y - 10), "Out", "Quad", 0.4, true);
					Tab:TweenSize(UDim2.new(0, WindowConfig.TabWidth, 0, Main.AbsoluteSize.Y - Top.AbsoluteSize.Y - 10), "Out", "Quad", 0.4, true);
				end);
				OutlineMain:TweenSize(UDim2.new(1, -10, 1, -10), "Out", "Quad", 0.4, true);
				ResizeButton.Image = "rbxassetid://10734895698";
			else
				defaultSize = true;
				Main:TweenSize(UDim2.new(0, WindowConfig.Size.X.Offset, 0, WindowConfig.Size.Y.Offset), "Out", "Quad", 0.4, true, function()
					Page:TweenSize(UDim2.new(0, Main.AbsoluteSize.X - Tab.AbsoluteSize.X - 25, 0, Main.AbsoluteSize.Y - Top.AbsoluteSize.Y - 10), "Out", "Quad", 0.4, true);
					Tab:TweenSize(UDim2.new(0, WindowConfig.TabWidth, 0, Main.AbsoluteSize.Y - Top.AbsoluteSize.Y - 10), "Out", "Quad", 0.4, true);
				end);
				OutlineMain:TweenSize(UDim2.new(0, WindowConfig.Size.X.Offset + 15, 0, WindowConfig.Size.Y.Offset + 15), "Out", "Quad", 0.4, true);
				ResizeButton.Image = "rbxassetid://10734886735";
			end;
		end);
		local main = {};
		function main:Button(text, callback)
			local Button = Instance.new("Frame");
			local UICorner = Instance.new("UICorner");
			local TextLabel = Instance.new("TextLabel");
			local TextButton = Instance.new("TextButton");
			local UICorner_2 = Instance.new("UICorner");
			local Black = Instance.new("Frame");
			local UICorner_3 = Instance.new("UICorner");
			Button.Name = "Button";
			Button.Parent = MainFramePage;
			Button.BackgroundColor3 = _G.Primary;
			Button.BackgroundTransparency = 1;
			Button.Size = UDim2.new(1, 0, 0, 36);
			UICorner.CornerRadius = UDim.new(0, 5);
			UICorner.Parent = Button;
			local ImageLabel = Instance.new("ImageLabel");
			ImageLabel.Name = "ImageLabel";
			ImageLabel.Parent = TextButton;
			ImageLabel.BackgroundColor3 = _G.Primary;
			ImageLabel.BackgroundTransparency = 1;
			ImageLabel.AnchorPoint = Vector2.new(0.5, 0.5);
			ImageLabel.Position = UDim2.new(0.5, 0, 0.5, 0);
			ImageLabel.Size = UDim2.new(0, 15, 0, 15);
			ImageLabel.Image = "rbxassetid://10734898355";
			ImageLabel.ImageTransparency = 0;
			ImageLabel.ImageColor3 = Color3.fromRGB(255, 255, 255);
			CreateRounded(TextButton, 4);
			TextButton.Name = "TextButton";
			TextButton.Parent = Button;
			TextButton.BackgroundColor3 = Color3.fromRGB(200, 200, 200);
			TextButton.BackgroundTransparency = 0.8;
			TextButton.AnchorPoint = Vector2.new(1, 0.5);
			TextButton.Position = UDim2.new(1, -1, 0.5, 0);
			TextButton.Size = UDim2.new(0, 25, 0, 25);
			TextButton.Font = Enum.Font.Nunito;
			TextButton.Text = "";
			TextButton.TextXAlignment = Enum.TextXAlignment.Left;
			TextButton.TextColor3 = Color3.fromRGB(255, 255, 255);
			TextButton.TextSize = 15;
			TextLabel.Name = "TextLabel";
			TextLabel.Parent = Button;
			TextLabel.BackgroundColor3 = _G.Primary;
			TextLabel.BackgroundTransparency = 1;
			TextLabel.AnchorPoint = Vector2.new(0, 0.5);
			TextLabel.Position = UDim2.new(0, 20, 0.5, 0);
			TextLabel.Size = UDim2.new(1, -50, 1, 0);
			TextLabel.Font = Enum.Font.Cartoon;
			TextLabel.RichText = true;
			TextLabel.Text = text;
			TextLabel.TextXAlignment = Enum.TextXAlignment.Left;
			TextLabel.TextColor3 = Color3.fromRGB(255, 255, 255);
			TextLabel.TextSize = 15;
			TextLabel.ClipsDescendants = true;
            local ArrowRight = Instance.new("ImageLabel");
			ArrowRight.Name = "ArrowRight";
			ArrowRight.Parent = Button;
			ArrowRight.BackgroundColor3 = _G.Primary;
			ArrowRight.BackgroundTransparency = 1;
			ArrowRight.AnchorPoint = Vector2.new(0, 0.5);
			ArrowRight.Position = UDim2.new(0, 0, 0.5, 0);
			ArrowRight.Size = UDim2.new(0, 15, 0, 15);
			ArrowRight.Image = "rbxassetid://10709768347";
			ArrowRight.ImageTransparency = 0;
			ArrowRight.ImageColor3 = Color3.fromRGB(255, 255, 255);
			Black.Name = "Black";
			Black.Parent = Button;
			Black.BackgroundColor3 = Color3.fromRGB(0, 0, 0);
			Black.BackgroundTransparency = 1;
			Black.BorderSizePixel = 0;
			Black.Position = UDim2.new(0, 0, 0, 0);
			Black.Size = UDim2.new(1, 0, 0, 33);
			UICorner_3.CornerRadius = UDim.new(0, 5);
			UICorner_3.Parent = Black;
			TextButton.MouseButton1Click:Connect(function()
				callback();
			end);
		end;
		function main:Toggle(text, config, desc, callback)
    config = config or false
    local toggled = config

    local Button = Instance.new("Frame")
    Button.Name = "Toggle"
    Button.BackgroundColor3 = _G.Primary
    Button.BackgroundTransparency = 0.85
    Button.Size = desc and UDim2.new(1, 0, 0, 46) or UDim2.new(1, 0, 0, 36)
    Button.Parent = MainFramePage
    CreateRounded(Button, 8)

    local Title2 = Instance.new("TextLabel")
    Title2.BackgroundTransparency = 1
    Title2.Position = desc and UDim2.new(0, 15, 0, 7) or UDim2.new(0, 15, 0.5, 0)
    Title2.AnchorPoint = desc and Vector2.new(0, 0) or Vector2.new(0, 0.5)
    Title2.Size = UDim2.new(1, -65, 0, 18)
    Title2.Font = Enum.Font.GothamSemibold
    Title2.Text = text
    Title2.TextColor3 = Color3.fromRGB(255, 255, 255)
    Title2.TextSize = 13
    Title2.TextXAlignment = Enum.TextXAlignment.Left
    Title2.BackgroundColor3 = Color3.fromRGB(0,0,0)
    Title2.Parent = Button

    if desc then
        local Desc = Instance.new("TextLabel")
        Desc.BackgroundTransparency = 1
        Desc.Position = UDim2.new(0, 15, 0, 26)
        Desc.Size = UDim2.new(1, -65, 0, 16)
        Desc.Font = Enum.Font.Gotham
        Desc.Text = desc
        Desc.TextColor3 = Color3.fromRGB(150, 150, 150)
        Desc.TextSize = 11
        Desc.TextXAlignment = Enum.TextXAlignment.Left
        Desc.Parent = Button
    end

    local ToggleOuter = Instance.new("Frame")
    ToggleOuter.AnchorPoint = Vector2.new(1, 0.5)
    ToggleOuter.Position = UDim2.new(1, -14, 0.5, 0)
    ToggleOuter.Size = UDim2.new(0, 38, 0, 20)
    ToggleOuter.BackgroundColor3 = Color3.fromRGB(45, 45, 48)
    ToggleOuter.Parent = Button
    CreateRounded(ToggleOuter, 99)

    local ToggleStroke = Instance.new("UIStroke")
    ToggleStroke.Color = Color3.fromRGB(70, 70, 75)
    ToggleStroke.Thickness = 1
    ToggleStroke.Transparency = 0.3
    ToggleStroke.Parent = ToggleOuter

    local Circle = Instance.new("Frame")
    Circle.AnchorPoint = Vector2.new(0, 0.5)
    Circle.Position = UDim2.new(0, 3, 0.5, 0)
    Circle.Size = UDim2.new(0, 14, 0, 14)
    Circle.BackgroundColor3 = Color3.fromRGB(255, 255, 255)
    Circle.Parent = ToggleOuter
    CreateRounded(Circle, 99)

    local function Render(animated)
        local time = animated and 0.22 or 0
        if toggled then
            TweenService:Create(Circle, TweenInfo.new(time, Enum.EasingStyle.Back), {Position = UDim2.new(0, 21, 0.5, 0)}):Play()
            TweenService:Create(ToggleOuter, TweenInfo.new(time, Enum.EasingStyle.Quad), {BackgroundColor3 = _G.Third}):Play()
            TweenService:Create(ToggleStroke, TweenInfo.new(time, Enum.EasingStyle.Quad), {Transparency = 1}):Play()
        else
            TweenService:Create(Circle, TweenInfo.new(time, Enum.EasingStyle.Back), {Position = UDim2.new(0, 3, 0.5, 0)}):Play()
            TweenService:Create(ToggleOuter, TweenInfo.new(time, Enum.EasingStyle.Quad), {BackgroundColor3 = Color3.fromRGB(45, 45, 48)}):Play()
            TweenService:Create(ToggleStroke, TweenInfo.new(time, Enum.EasingStyle.Quad), {Transparency = 0.3}):Play()
        end
    end

    local ClickArea = Instance.new("TextButton")
    ClickArea.BackgroundTransparency = 1
    ClickArea.Text = ""
    ClickArea.Size = UDim2.new(1, 0, 1, 0)
    ClickArea.Parent = Button

    ClickArea.MouseButton1Click:Connect(function()
        toggled = not toggled
        Render(true)
        pcall(callback, toggled)
    end)

    Render(false)
    pcall(callback, toggled)

    local togglefunc = {}
    togglefunc.Instance = Button
    function togglefunc:Get() return toggled end
    function togglefunc:Set(value)
        toggled = value
        Render(true)
        pcall(callback, toggled)
    end
    function togglefunc:Destroy() Button:Destroy() end
    return togglefunc
		end
		function main:Dropdown(text, options, default, callback)
    local isOpen = false
    local selected = default

    local Card = Instance.new("Frame")
    Card.BackgroundColor3 = _G.Primary
    Card.BackgroundTransparency = 0.85
    Card.Size = UDim2.new(1, 0, 0, 40)
    Card.ClipsDescendants = true
    Card.Parent = MainFramePage
    CreateRounded(Card, 8)

    local Title = Instance.new("TextLabel")
    Title.BackgroundTransparency = 1
    Title.Position = UDim2.new(0, 15, 0, 6)
    Title.Size = UDim2.new(1, -120, 0, 16)
    Title.Font = Enum.Font.GothamSemibold
    Title.Text = text
    Title.TextColor3 = Color3.fromRGB(255, 255, 255)
    Title.TextSize = 12
    Title.TextXAlignment = Enum.TextXAlignment.Left
    Title.Parent = Card

    local SelectButton = Instance.new("TextButton")
    SelectButton.AnchorPoint = Vector2.new(1, 0)
    SelectButton.Position = UDim2.new(1, -10, 0, 6)
    SelectButton.Size = UDim2.new(0, 110, 0, 22)
    SelectButton.BackgroundColor3 = Color3.fromRGB(30, 30, 33)
    SelectButton.Font = Enum.Font.GothamMedium
    SelectButton.Text = tostring(selected or "Selecionar")
    SelectButton.TextColor3 = Color3.fromRGB(230, 230, 230)
    SelectButton.TextSize = 11
    SelectButton.AutoButtonColor = false
    SelectButton.Parent = Card
    CreateRounded(SelectButton, 6)

    local Arrow = Instance.new("ImageLabel")
    Arrow.AnchorPoint = Vector2.new(1, 0.5)
    Arrow.Position = UDim2.new(1, -8, 0.5, 0)
    Arrow.Size = UDim2.new(0, 12, 0, 12)
    Arrow.BackgroundTransparency = 1
    Arrow.Image = "rbxassetid://10709790948"
    Arrow.ImageColor3 = Color3.fromRGB(200, 200, 200)
    Arrow.Parent = SelectButton

    local ListHolder = Instance.new("Frame")
    ListHolder.BackgroundColor3 = Color3.fromRGB(22, 22, 24)
    ListHolder.Position = UDim2.new(0, 6, 0, 38)
    ListHolder.Size = UDim2.new(1, -12, 0, 0)
    ListHolder.ClipsDescendants = true
    ListHolder.Parent = Card
    CreateRounded(ListHolder, 6)

    local Scroll = Instance.new("ScrollingFrame")
    Scroll.BackgroundTransparency = 1
    Scroll.Size = UDim2.new(1, 0, 1, -6)
    Scroll.Position = UDim2.new(0, 0, 0, 4)
    Scroll.ScrollBarThickness = 3
    Scroll.BorderSizePixel = 0
    Scroll.Parent = ListHolder

    local Layout = Instance.new("UIListLayout")
    Layout.Padding = UDim.new(0, 2)
    Layout.Parent = Scroll

    local Pad = Instance.new("UIPadding")
    Pad.PaddingLeft = UDim.new(0, 6)
    Pad.PaddingRight = UDim.new(0, 6)
    Pad.Parent = Scroll

    local itemButtons = {}

    local function refreshHighlight()
        for _, btn in pairs(itemButtons) do
            local isSel = btn:GetAttribute("Value") == selected
            TweenService:Create(btn, TweenInfo.new(0.15), {
                BackgroundTransparency = isSel and 0.75 or 1
            }):Play()
        end
    end

    local function addItem(value)
        local Item = Instance.new("TextButton")
        Item.BackgroundColor3 = _G.Third
        Item.BackgroundTransparency = 1
        Item.Size = UDim2.new(1, 0, 0, 26)
        Item.Font = Enum.Font.Gotham
        Item.Text = tostring(value)
        Item.TextColor3 = Color3.fromRGB(230, 230, 230)
        Item.TextSize = 12
        Item.TextXAlignment = Enum.TextXAlignment.Left
        Item.AutoButtonColor = false
        Item.Parent = Scroll
        Item:SetAttribute("Value", value)
        CreateRounded(Item, 5)

        local ItemPad = Instance.new("UIPadding")
        ItemPad.PaddingLeft = UDim.new(0, 8)
        ItemPad.Parent = Item

        Item.MouseButton1Click:Connect(function()
            selected = value
            SelectButton.Text = tostring(value)
            refreshHighlight()
            pcall(callback, value)
        end)

        table.insert(itemButtons, Item)
    end

    for _, v in ipairs(options) do
        addItem(v)
    end

    Layout:GetPropertyChangedSignal("AbsoluteContentSize"):Connect(function()
        Scroll.CanvasSize = UDim2.new(0, 0, 0, Layout.AbsoluteContentSize.Y)
    end)

    SelectButton.MouseButton1Click:Connect(function()
        isOpen = not isOpen
        local listHeight = math.min(#itemButtons * 28 + 6, 140)
        TweenService:Create(Card, TweenInfo.new(0.22, Enum.EasingStyle.Quart), {
            Size = UDim2.new(1, 0, 0, isOpen and (40 + listHeight) or 40)
        }):Play()
        TweenService:Create(ListHolder, TweenInfo.new(0.22, Enum.EasingStyle.Quart), {
            Size = UDim2.new(1, -12, 0, isOpen and listHeight or 0)
        }):Play()
        TweenService:Create(Arrow, TweenInfo.new(0.22), {Rotation = isOpen and 180 or 0}):Play()
    end)

    refreshHighlight()
    if selected then pcall(callback, selected) end

    local dropfunc = {}
    dropfunc.Instance = Card
    function dropfunc:Get() return selected end
    function dropfunc:Set(value)
        selected = value
        SelectButton.Text = tostring(value)
        refreshHighlight()
        pcall(callback, value)
    end
    function dropfunc:Add(value) addItem(value) end
    function dropfunc:Clear()
        for _, btn in pairs(itemButtons) do btn:Destroy() end
        itemButtons = {}
        selected = nil
        SelectButton.Text = "Selecionar"
    end
    return dropfunc
		end
			
		-- Coloque isso após a criação das Tabs (Window já definida)
        function main:MultiDropdown(text, options, defaultList, callback)
    local isOpen = false
    local selected = {}
    for _, v in ipairs(defaultList or {}) do selected[v] = true end

    local Card = Instance.new("Frame")
    Card.BackgroundColor3 = _G.Primary
    Card.BackgroundTransparency = 0.85
    Card.Size = UDim2.new(1, 0, 0, 40)
    Card.ClipsDescendants = true
    Card.Parent = MainFramePage
    CreateRounded(Card, 8)

    local Title = Instance.new("TextLabel")
    Title.BackgroundTransparency = 1
    Title.Position = UDim2.new(0, 15, 0, 6)
    Title.Size = UDim2.new(1, -130, 0, 16)
    Title.Font = Enum.Font.GothamSemibold
    Title.Text = text
    Title.TextColor3 = Color3.fromRGB(255, 255, 255)
    Title.TextSize = 12
    Title.TextXAlignment = Enum.TextXAlignment.Left
    Title.Parent = Card

    local SelectButton = Instance.new("TextButton")
    SelectButton.AnchorPoint = Vector2.new(1, 0)
    SelectButton.Position = UDim2.new(1, -10, 0, 6)
    SelectButton.Size = UDim2.new(0, 120, 0, 22)
    SelectButton.BackgroundColor3 = Color3.fromRGB(30, 30, 33)
    SelectButton.Font = Enum.Font.GothamMedium
    SelectButton.TextColor3 = Color3.fromRGB(230, 230, 230)
    SelectButton.TextSize = 11
    SelectButton.AutoButtonColor = false
    SelectButton.Parent = Card
    CreateRounded(SelectButton, 6)

    local Arrow = Instance.new("ImageLabel")
    Arrow.AnchorPoint = Vector2.new(1, 0.5)
    Arrow.Position = UDim2.new(1, -8, 0.5, 0)
    Arrow.Size = UDim2.new(0, 12, 0, 12)
    Arrow.BackgroundTransparency = 1
    Arrow.Image = "rbxassetid://10709790948"
    Arrow.ImageColor3 = Color3.fromRGB(200, 200, 200)
    Arrow.Parent = SelectButton

    local ListHolder = Instance.new("Frame")
    ListHolder.BackgroundColor3 = Color3.fromRGB(22, 22, 24)
    ListHolder.Position = UDim2.new(0, 6, 0, 38)
    ListHolder.Size = UDim2.new(1, -12, 0, 0)
    ListHolder.ClipsDescendants = true
    ListHolder.Parent = Card
    CreateRounded(ListHolder, 6)

    local Scroll = Instance.new("ScrollingFrame")
    Scroll.BackgroundTransparency = 1
    Scroll.Size = UDim2.new(1, 0, 1, -6)
    Scroll.Position = UDim2.new(0, 0, 0, 4)
    Scroll.ScrollBarThickness = 3
    Scroll.BorderSizePixel = 0
    Scroll.Parent = ListHolder

    local Layout = Instance.new("UIListLayout")
    Layout.Padding = UDim.new(0, 2)
    Layout.Parent = Scroll

    local Pad = Instance.new("UIPadding")
    Pad.PaddingLeft = UDim.new(0, 6)
    Pad.PaddingRight = UDim.new(0, 6)
    Pad.Parent = Scroll

    local function updateSummary()
        local count = 0
        for _ in pairs(selected) do count += 1 end
        SelectButton.Text = count == 0 and "Selecionar" or (count .. " selecionado" .. (count > 1 and "s" or ""))
    end

    local function getList()
        local list = {}
        for name in pairs(selected) do table.insert(list, name) end
        return list
    end

    local itemRenders = {}

    local function addItem(value)
        local Item = Instance.new("TextButton")
        Item.BackgroundTransparency = 1
        Item.Size = UDim2.new(1, 0, 0, 26)
        Item.Text = ""
        Item.AutoButtonColor = false
        Item.Parent = Scroll
        CreateRounded(Item, 5)

        local Check = Instance.new("Frame")
        Check.AnchorPoint = Vector2.new(0, 0.5)
        Check.Position = UDim2.new(0, 6, 0.5, 0)
        Check.Size = UDim2.new(0, 14, 0, 14)
        Check.BackgroundColor3 = Color3.fromRGB(45, 45, 48)
        Check.Parent = Item
        CreateRounded(Check, 4)

        local CheckStroke = Instance.new("UIStroke")
        CheckStroke.Color = Color3.fromRGB(80, 80, 85)
        CheckStroke.Thickness = 1
        CheckStroke.Parent = Check

        local CheckIcon = Instance.new("ImageLabel")
        CheckIcon.Size = UDim2.new(1, 0, 1, 0)
        CheckIcon.BackgroundTransparency = 1
        CheckIcon.Image = "rbxassetid://10709790644"
        CheckIcon.ImageColor3 = Color3.fromRGB(20, 20, 20)
        CheckIcon.ImageTransparency = 1
        CheckIcon.Parent = Check

        local Label = Instance.new("TextLabel")
        Label.BackgroundTransparency = 1
        Label.Position = UDim2.new(0, 28, 0, 0)
        Label.Size = UDim2.new(1, -32, 1, 0)
        Label.Font = Enum.Font.Gotham
        Label.Text = tostring(value)
        Label.TextColor3 = Color3.fromRGB(230, 230, 230)
        Label.TextSize = 12
        Label.TextXAlignment = Enum.TextXAlignment.Left
        Label.Parent = Item

        local function render()
            local on = selected[value] == true
            TweenService:Create(Check, TweenInfo.new(0.15), {BackgroundColor3 = on and _G.Third or Color3.fromRGB(45, 45, 48)}):Play()
            TweenService:Create(CheckIcon, TweenInfo.new(0.15), {ImageTransparency = on and 0 or 1}):Play()
        end

        Item.MouseButton1Click:Connect(function()
            selected[value] = selected[value] and nil or true
            render()
            updateSummary()
            pcall(callback, getList())
        end)

        render()
        itemRenders[value] = render
    end

    for _, v in ipairs(options) do
        addItem(v)
    end

    Layout:GetPropertyChangedSignal("AbsoluteContentSize"):Connect(function()
        Scroll.CanvasSize = UDim2.new(0, 0, 0, Layout.AbsoluteContentSize.Y)
    end)

    SelectButton.MouseButton1Click:Connect(function()
        isOpen = not isOpen
        local listHeight = math.min(#options * 28 + 6, 160)
        TweenService:Create(Card, TweenInfo.new(0.22, Enum.EasingStyle.Quart), {
            Size = UDim2.new(1, 0, 0, isOpen and (40 + listHeight) or 40)
        }):Play()
        TweenService:Create(ListHolder, TweenInfo.new(0.22, Enum.EasingStyle.Quart), {
            Size = UDim2.new(1, -12, 0, isOpen and listHeight or 0)
        }):Play()
        TweenService:Create(Arrow, TweenInfo.new(0.22), {Rotation = isOpen and 180 or 0}):Play()
    end)

    updateSummary()
    pcall(callback, getList())

    local multi = {}
    multi.Instance = Card
    function multi:Get() return getList() end
    function multi:Set(list)
        selected = {}
        for _, v in ipairs(list) do selected[v] = true end
        for _, render in pairs(itemRenders) do render() end
        updateSummary()
        pcall(callback, getList())
    end
    function multi:Destroy() Card:Destroy() end
    return multi
end

 
		function main:Slider(text, min, max, default, callback)
    local Value = default or min

    local Holder = Instance.new("Frame")
    Holder.BackgroundColor3 = _G.Primary
    Holder.BackgroundTransparency = 0.85
    Holder.Size = UDim2.new(1, 0, 0, 44)
    Holder.Parent = MainFramePage
    CreateRounded(Holder, 8)

    local Title = Instance.new("TextLabel")
    Title.BackgroundTransparency = 1
    Title.Position = UDim2.new(0, 15, 0, 6)
    Title.Size = UDim2.new(1, -70, 0, 16)
    Title.Font = Enum.Font.GothamSemibold
    Title.Text = text
    Title.TextColor3 = Color3.fromRGB(255, 255, 255)
    Title.TextSize = 12
    Title.TextXAlignment = Enum.TextXAlignment.Left
    Title.Parent = Holder

    local ValueBadge = Instance.new("Frame")
    ValueBadge.AnchorPoint = Vector2.new(1, 0)
    ValueBadge.Position = UDim2.new(1, -10, 0, 4)
    ValueBadge.Size = UDim2.new(0, 44, 0, 18)
    ValueBadge.BackgroundColor3 = Color3.fromRGB(30, 30, 33)
    ValueBadge.Parent = Holder
    CreateRounded(ValueBadge, 6)

    local ValueText = Instance.new("TextLabel")
    ValueText.Size = UDim2.new(1, 0, 1, 0)
    ValueText.BackgroundTransparency = 1
    ValueText.Font = Enum.Font.GothamMedium
    ValueText.Text = tostring(Value)
    ValueText.TextColor3 = Color3.fromRGB(230, 230, 230)
    ValueText.TextSize = 11
    ValueText.Parent = ValueBadge

    local Track = Instance.new("Frame")
    Track.Position = UDim2.new(0, 15, 0, 30)
    Track.Size = UDim2.new(1, -30, 0, 6)
    Track.BackgroundColor3 = Color3.fromRGB(45, 45, 48)
    Track.Parent = Holder
    CreateRounded(Track, 99)

    local Fill = Instance.new("Frame")
    Fill.Size = UDim2.new((Value - min) / (max - min), 0, 1, 0)
    Fill.BackgroundColor3 = _G.Third
    Fill.Parent = Track
    CreateRounded(Fill, 99)

    local Thumb = Instance.new("Frame")
    Thumb.AnchorPoint = Vector2.new(0.5, 0.5)
    Thumb.Position = UDim2.new(1, 0, 0.5, 0)
    Thumb.Size = UDim2.new(0, 14, 0, 14)
    Thumb.BackgroundColor3 = Color3.fromRGB(255, 255, 255)
    Thumb.Parent = Fill
    CreateRounded(Thumb, 99)

    local ThumbStroke = Instance.new("UIStroke")
    ThumbStroke.Color = Color3.fromRGB(0, 0, 0)
    ThumbStroke.Transparency = 0.7
    ThumbStroke.Thickness = 1.5
    ThumbStroke.Parent = Thumb

    local dragging = false

    local function setFromPercent(pct, animated)
        pct = math.clamp(pct, 0, 1)
        Value = math.floor(min + (max - min) * pct)
        ValueText.Text = tostring(Value)
        TweenService:Create(Fill, TweenInfo.new(animated and 0.12 or 0), {Size = UDim2.new(pct, 0, 1, 0)}):Play()
        pcall(callback, Value)
    end

    local function inputToPercent(input)
        return (input.Position.X - Track.AbsolutePosition.X) / Track.AbsoluteSize.X
    end

    Track.InputBegan:Connect(function(input)
        if input.UserInputType == Enum.UserInputType.MouseButton1 or input.UserInputType == Enum.UserInputType.Touch then
            dragging = true
            setFromPercent(inputToPercent(input), true)
        end
    end)
    Thumb.InputBegan:Connect(function(input)
        if input.UserInputType == Enum.UserInputType.MouseButton1 or input.UserInputType == Enum.UserInputType.Touch then
            dragging = true
        end
    end)
    UserInputService.InputEnded:Connect(function(input)
        if input.UserInputType == Enum.UserInputType.MouseButton1 or input.UserInputType == Enum.UserInputType.Touch then
            dragging = false
        end
    end)
    UserInputService.InputChanged:Connect(function(input)
        if dragging and (input.UserInputType == Enum.UserInputType.MouseMovement or input.UserInputType == Enum.UserInputType.Touch) then
            setFromPercent(inputToPercent(input), false)
        end
    end)

    pcall(callback, Value)

    local sliderfunc = {}
    sliderfunc.Instance = Holder
    function sliderfunc:Get() return Value end
    function sliderfunc:Set(v) setFromPercent((v - min) / (max - min), true) end
    function sliderfunc:Destroy() Holder:Destroy() end
    return sliderfunc
end

			
	
		function main:Textbox(text, disappear, callback)
			local Textbox = Instance.new("Frame");
			local TextboxCorner = Instance.new("UICorner");
			local TextboxLabel = Instance.new("TextLabel");
			local RealTextbox = Instance.new("TextBox");
			local UICorner = Instance.new("UICorner");
			local TextBoxIcon = Instance.new("ImageLabel");
			Textbox.Name = "Textbox";
			Textbox.Parent = MainFramePage;
			Textbox.BackgroundColor3 = _G.Primary;
			Textbox.BackgroundTransparency = 0.8;
			Textbox.Size = UDim2.new(1, 0, 0, 35);
			TextboxCorner.CornerRadius = UDim.new(0, 5);
			TextboxCorner.Name = "TextboxCorner";
			TextboxCorner.Parent = Textbox;
			TextboxLabel.Name = "TextboxLabel";
			TextboxLabel.Parent = Textbox;
			TextboxLabel.BackgroundColor3 = _G.Primary;
			TextboxLabel.BackgroundTransparency = 1;
			TextboxLabel.Position = UDim2.new(0, 15, 0.5, 0);
			TextboxLabel.Text = text;
			TextboxLabel.Size = UDim2.new(1, 0, 0, 35);
			TextboxLabel.Font = Enum.Font.Nunito;
			TextboxLabel.AnchorPoint = Vector2.new(0, 0.5);
			TextboxLabel.TextColor3 = Color3.fromRGB(255, 255, 255);
			TextboxLabel.TextSize = 15;
			TextboxLabel.TextTransparency = 0;
			TextboxLabel.TextXAlignment = Enum.TextXAlignment.Left;
			RealTextbox.Name = "RealTextbox";
			RealTextbox.Parent = Textbox;
			RealTextbox.BackgroundColor3 = Color3.fromRGB(200, 200, 200);
			RealTextbox.BackgroundTransparency = 0.8;
			RealTextbox.Position = UDim2.new(1, -5, 0.5, 0);
			RealTextbox.AnchorPoint = Vector2.new(1, 0.5);
			RealTextbox.Size = UDim2.new(0, 80, 0, 25);
			RealTextbox.Font = Enum.Font.Gotham;
			RealTextbox.Text = "";
			RealTextbox.TextColor3 = Color3.fromRGB(225, 225, 225);
			RealTextbox.TextSize = 11;
			RealTextbox.TextTransparency = 0;
			RealTextbox.ClipsDescendants = true;
			RealTextbox.FocusLost:Connect(function()
				callback(RealTextbox.Text);
			end);
			UICorner.CornerRadius = UDim.new(0, 5);
			UICorner.Parent = RealTextbox;
		end;
		function main:Label(text)
			local Frame = Instance.new("Frame");
			local Label = Instance.new("TextLabel");
			local PaddingLabel = Instance.new("UIPadding");
			local labelfunc = {};
			Frame.Name = "Frame";
			Frame.Parent = MainFramePage;
			Frame.BackgroundColor3 = _G.Primary;
			Frame.BackgroundTransparency = 1;
			Frame.Size = UDim2.new(1, 0, 0, 30);
			Label.Name = "Label";
			Label.Parent = Frame;
			Label.BackgroundColor3 = Color3.fromRGB(255, 255, 255);
			Label.BackgroundTransparency = 1;
			Label.Size = UDim2.new(1, -30, 0, 30);
			Label.Font = Enum.Font.Nunito;
			Label.Position = UDim2.new(0, 30, 0.5, 0);
			Label.AnchorPoint = Vector2.new(0, 0.5);
			Label.TextColor3 = Color3.fromRGB(225, 225, 225);
			Label.TextSize = 15;
			Label.Text = text;
			Label.TextXAlignment = Enum.TextXAlignment.Left;
			local ImageLabel = Instance.new("ImageLabel");
			ImageLabel.Name = "ImageLabel";
			ImageLabel.Parent = Frame;
			ImageLabel.BackgroundColor3 = Color3.fromRGB(200, 200, 200);
			ImageLabel.BackgroundTransparency = 1;
			ImageLabel.ImageTransparency = 0;
			ImageLabel.Position = UDim2.new(0, 10, 0.5, 0);
			ImageLabel.Size = UDim2.new(0, 14, 0, 14);
			ImageLabel.AnchorPoint = Vector2.new(0, 0.5);
			ImageLabel.Image = "rbxassetid://10723415903";
			ImageLabel.ImageColor3 = Color3.fromRGB(200, 200, 200);
			function labelfunc:Set(newtext)
				Label.Text = newtext;
			end;
			return labelfunc;
		end;
		function main:Seperator(text)
    local Seperator = Instance.new("Frame");
    local Sep1 = Instance.new("TextLabel");
    local Sep2 = Instance.new("TextLabel");
    local Sep3 = Instance.new("TextLabel");
    local SepRadius = Instance.new("UICorner");
    Seperator.Name = "Seperator";
    Seperator.Parent = MainFramePage;
    Seperator.BackgroundColor3 = _G.Primary;
    Seperator.BackgroundTransparency = 1;
    Seperator.Size = UDim2.new(1, 0, 0, 36);
    Sep1.Name = "Sep1";
    Sep1.Parent = Seperator;
    Sep1.BackgroundColor3 = Color3.fromRGB(255, 255, 255);
    Sep1.BackgroundTransparency = 1;
    Sep1.AnchorPoint = Vector2.new(0, 0.5);
    Sep1.Position = UDim2.new(0, 0, 0.5, 0);
    Sep1.Size = UDim2.new(0, 20, 0, 36);
    Sep1.Font = Enum.Font.GothamBold;
    Sep1.RichText = true;
    Sep1.Text = "<font color=\"rgb(255, 255, 255)\">•</font>";  -- caractere limpo, branco
    Sep1.TextColor3 = Color3.fromRGB(255, 255, 255);
    Sep1.TextSize = 14;
    Sep2.Name = "Sep2";
    Sep2.Parent = Seperator;
    Sep2.BackgroundColor3 = Color3.fromRGB(255, 255, 255);
    Sep2.BackgroundTransparency = 1;
    Sep2.AnchorPoint = Vector2.new(0.5, 0.5);
    Sep2.Position = UDim2.new(0.5, 0, 0.5, 0);
    Sep2.Size = UDim2.new(1, 0, 0, 36);
    Sep2.Font = Enum.Font.GothamBold;
    Sep2.Text = text;
    Sep2.TextColor3 = Color3.fromRGB(255, 255, 255);
    Sep2.TextSize = 14;
    Sep3.Name = "Sep3";
    Sep3.Parent = Seperator;
    Sep3.BackgroundColor3 = Color3.fromRGB(255, 255, 255);
    Sep3.BackgroundTransparency = 1;
    Sep3.AnchorPoint = Vector2.new(1, 0.5);
    Sep3.Position = UDim2.new(1, 0, 0.5, 0);
    Sep3.Size = UDim2.new(0, 20, 0, 36);
    Sep3.Font = Enum.Font.GothamBold;
    Sep3.RichText = true;
    Sep3.Text = "<font color=\"rgb(255, 255, 255)\">•</font>";  -- caractere limpo, branco
    Sep3.TextColor3 = Color3.fromRGB(255, 255, 255);
    Sep3.TextSize = 14;
end;
		function main:Line()
			local Linee = Instance.new("Frame");
			local Line = Instance.new("Frame");
			local UIGradient = Instance.new("UIGradient");
			Linee.Name = "Linee";
			Linee.Parent = MainFramePage;
			Linee.BackgroundColor3 = Color3.fromRGB(255, 255, 255);
			Linee.BackgroundTransparency = 1;
			Linee.Position = UDim2.new(0, 0, 0.119999997, 0);
			Linee.Size = UDim2.new(1, 0, 0, 20);
			Line.Name = "Line";
			Line.Parent = Linee;
			Line.BackgroundColor3 = Color3.new(125, 125, 125);
			Line.BorderSizePixel = 0;
			Line.Position = UDim2.new(0, 0, 0, 10);
			Line.Size = UDim2.new(1, 0, 0, 1);
			UIGradient.Color = ColorSequence.new({
				ColorSequenceKeypoint.new(0, _G.Dark),
				ColorSequenceKeypoint.new(0.4, _G.Primary),
				ColorSequenceKeypoint.new(0.5, _G.Primary),
				ColorSequenceKeypoint.new(0.6, _G.Primary),
				ColorSequenceKeypoint.new(1, _G.Dark)
			});
			UIGradient.Parent = Line;
		end;
		return main;
	end;
	return uitab;
end;
return Update;
