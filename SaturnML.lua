local Players = game:GetService("Players")
local TweenService = game:GetService("TweenService")
local UserInputService = game:GetService("UserInputService")
local RunService = game:GetService("RunService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Lighting = game:GetService("Lighting")
local VirtualInputManager = game:GetService("VirtualInputManager")
local LocalPlayer = Players.LocalPlayer
local Camera = workspace.CurrentCamera

-- Carregar WindUI
local WindUI = loadstring(game:HttpGet("https://raw.githubusercontent.com/Footagesus/WindUI/main/dist/main.lua"))()

-- ==================== JANELA PRINCIPAL ====================
local Window = WindUI:CreateWindow({
    Title = "Saturn Hub | Muscle Legends",
    Author = "Satn",
    Folder = "Saturn Hub Muscle Legends",
    Theme = "Dark",
    Size = UDim2.fromOffset(600, 520),
    MinSize = Vector2.new(500, 400),
    Resizable = true,
    SideBarWidth = 160,
    ShowMinimizeButton = true,
    MinimizeKey = Enum.KeyCode.RightControl,
})

-- ==================== ABAS ====================
local TabIntro      = Window:Tab({ Title = "Introduction", Icon = "lucide:house" })
local TabFarmV1     = Window:Tab({ Title = "Farm",       Icon = "lucide:dumbbel" })
local TabRebirth    = Window:Tab({ Title = "Rebirthing",   Icon = "lucide:refresh-cw" })
local TabTeleport   = Window:Tab({ Title = "Teleport",     Icon = "lucide:map-pin" })
local TabRocks      = Window:Tab({ Title = "Rocks",        Icon = "lucide:stone" })
local TabKilling    = Window:Tab({ Title = "Killing",      Icon = "lucide:swords" })
local TabPets       = Window:Tab({ Title = "Pets Hatch",   Icon = "lucide:egg" })
local TabUltimates  = Window:Tab({ Title = "Ultimates",    Icon = "lucide:zap" })
local TabStats      = Window:Tab({ Title = "Stats",        Icon = "lucide:bar-chart" })
local TabViewStats  = Window:Tab({ Title = "View Stats",   Icon = "lucide:eye" })
local TabMisc       = Window:Tab({ Title = "Misc",         Icon = "lucide:settings" })

-- ==================== FUNÇÕES AUXILIARES ====================
local function abbreviateNumber(n)
    if n >= 1e15 then return string.format("%.1fQa", n/1e15)
    elseif n >= 1e12 then return string.format("%.1fT", n/1e12)
    elseif n >= 1e9 then return string.format("%.1fB", n/1e9)
    elseif n >= 1e6 then return string.format("%.1fM", n/1e6)
    elseif n >= 1e3 then return string.format("%.1fK", n/1e3)
    else return tostring(n) end
end

-- ==================== INTRODUCTION ====================
TabIntro:Paragraph({
    Title = "Saturn Hub",
    Text = "On Top"
})

TabIntro:Button({
    Title = "AutoLiftGamepass",
    Callback = function()
        local gamepassIds = ReplicatedStorage.gamepassIds
        for _, v in pairs(gamepassIds:GetChildren()) do
            local int = Instance.new("IntValue")
            int.Name = v.Name
            int.Value = v.Value
            int.Parent = LocalPlayer.ownedGamepasses
        end
    end
})

-- ==================== REBIRTHING ====================
local rebirthSection = TabRebirth:Section({ Title = "Rebirthing Options", Opened = true })

local isAutoStrength = false
rebirthSection:Toggle({
    Title = "Auto Strength",
    Desc = "Auto strength with equip weight",
    Default = false,
    Callback = function(v)
        isAutoStrength = v
        task.spawn(function()
            while isAutoStrength do
                local backpack = LocalPlayer:FindFirstChild("Backpack")
                local char = LocalPlayer.Character or LocalPlayer.CharacterAdded:Wait()
                local hum = char:FindFirstChild("Humanoid")
                if backpack and hum then
                    local weight = char:FindFirstChild("Weight") or backpack:FindFirstChild("Weight")
                    if weight then
                        hum:EquipTool(weight)
                    end
                end
                LocalPlayer.muscleEvent:FireServer("rep")
                task.wait(0.1)
            end
        end)
    end
})

local sizeSpam = false
rebirthSection:Toggle({
    Title = "Auto Set Size 2",
    Desc = "Spams change size to 2",
    Default = false,
    Callback = function(v)
        sizeSpam = v
        task.spawn(function()
            while sizeSpam do
                ReplicatedStorage.rEvents.changeSpeedSizeRemote:InvokeServer("changeSize", 2)
                task.wait(0.1)
            end
        end)
    end
})

local lockPosition = false
local savedPosition = nil
rebirthSection:Toggle({
    Title = "Lock Position",
    Desc = "Locks character position",
    Default = false,
    Callback = function(v)
        lockPosition = v
        local char = LocalPlayer.Character
        local hum = char and char:FindFirstChild("Humanoid")
        local root = char and char:FindFirstChild("HumanoidRootPart")
        if v and hum and root then
            savedPosition = root.Position
            hum.WalkSpeed = 0
            task.spawn(function()
                while lockPosition do
                    if (root.Position - savedPosition).Magnitude > 0.1 then
                        root.CFrame = CFrame.new(savedPosition)
                    end
                    task.wait(0.05)
                end
            end)
        elseif hum then
            hum.WalkSpeed = 16
        end
    end
})

local teleportLoop = nil
rebirthSection:Toggle({
    Title = "Auto Teleport to King",
    Desc = "Teleports to Muscle King",
    Default = false,
    Callback = function(v)
        if v then
            teleportLoop = task.spawn(function()
                while task.wait(0) do
                    if LocalPlayer.Character then
                        LocalPlayer.Character:MoveTo(Vector3.new(-8646, 17, -5738))
                    end
                end
            end)
        elseif teleportLoop then
            task.cancel(teleportLoop)
            teleportLoop = nil
        end
    end
})

local autoRebirth = false
rebirthSection:Toggle({
    Title = "Auto Rebirth (Infinite)",
    Desc = "Rebirths infinitely",
    Default = false,
    Callback = function(v)
        autoRebirth = v
        task.spawn(function()
            while autoRebirth do
                ReplicatedStorage.rEvents.rebirthRemote:InvokeServer("rebirthRequest")
                task.wait(0.1)
            end
        end)
    end
})

local rebirthStopPoint = 0
rebirthSection:Input({
    Title = "Rebirth Stop Point",
    Placeholder = "Enter rebirth limit",
    Callback = function(text)
        rebirthStopPoint = tonumber(text) or 0
    end
})

local rebirthUntilStop = false
rebirthSection:Toggle({
    Title = "Rebirth Until Stop Point",
    Desc = "Stops at specified rebirth count",
    Default = false,
    Callback = function(v)
        rebirthUntilStop = v
        task.spawn(function()
            while rebirthUntilStop do
                local leaderstats = LocalPlayer:FindFirstChild("leaderstats")
                local reb = leaderstats and leaderstats:FindFirstChild("Rebirths")
                if reb and reb.Value >= rebirthStopPoint then
                    rebirthUntilStop = false
                    break
                end
                ReplicatedStorage.rEvents.rebirthRemote:InvokeServer("rebirthRequest")
                task.wait(0.1)
            end
        end)
    end
})

rebirthSection:Paragraph({ Title = "WARNING: Do Not Click The Button Of Fast Rebirth Without Having 7 Packs!" })

local fastRebirth = false
rebirthSection:Toggle({
    Title = "Fast Rebirth (Required 7 New Packs)",
    Desc = "Advanced rebirth with pet swapping",
    Default = false,
    Callback = function(v)
        fastRebirth = v
        if v then
            task.spawn(function()
                local function unequipAllPets()
                    for _, folder in pairs(LocalPlayer.petsFolder:GetChildren()) do
                        if folder:IsA("Folder") then
                            for _, pet in pairs(folder:GetChildren()) do
                                ReplicatedStorage.rEvents.equipPetEvent:FireServer("unequipPet", pet)
                            end
                        end
                    end
                    task.wait(0.1)
                end

                local function equipPet(name)
                    unequipAllPets()
                    task.wait(0.01)
                    for _, pet in pairs(LocalPlayer.petsFolder.Unique:GetChildren()) do
                        if pet.Name == name then
                            ReplicatedStorage.rEvents.equipPetEvent:FireServer("equipPet", pet)
                        end
                    end
                end

                local function findMachine(name)
                    local machine = workspace.machinesFolder:FindFirstChild(name)
                    if not machine then
                        for _, child in pairs(workspace:GetChildren()) do
                            if child:IsA("Folder") and child.Name:find("machines") then
                                machine = child:FindFirstChild(name)
                                if machine then break end
                            end
                        end
                    end
                    return machine
                end

                local function pressE()
                    VirtualInputManager:SendKeyEvent(true, "E", false, game)
                    task.wait(0.1)
                    VirtualInputManager:SendKeyEvent(false, "E", false, game)
                end

                while fastRebirth do
                    local requiredStrength = 10000 + 5000 * LocalPlayer.leaderstats.Rebirths.Value
                    if LocalPlayer.ultimatesFolder:FindFirstChild("Golden Rebirth") then
                        local value = LocalPlayer.ultimatesFolder["Golden Rebirth"].Value
                        requiredStrength = math.floor(requiredStrength * (1 - value * 0.1))
                    end

                    unequipAllPets()
                    task.wait(0.1)
                    equipPet("Swift Samurai")

                    while LocalPlayer.leaderstats.Strength.Value < requiredStrength do
                        for _ = 1, 15 do
                            LocalPlayer.muscleEvent:FireServer("rep")
                        end
                        task.wait()
                    end

                    unequipAllPets()
                    task.wait(0.1)
                    equipPet("Tribal Overlord")

                    local lift = findMachine("Jungle Bar Lift")
                    if lift and lift:FindFirstChild("interactSeat") then
                        LocalPlayer.Character.HumanoidRootPart.CFrame = lift.interactSeat.CFrame * CFrame.new(0, 3, 0)
                        repeat
                            task.wait(0.1)
                            pressE()
                        until LocalPlayer.Character.Humanoid.Sit
                    end

                    local oldRebirths = LocalPlayer.leaderstats.Rebirths.Value
                    repeat
                        ReplicatedStorage.rEvents.rebirthRemote:InvokeServer("rebirthRequest")
                        task.wait(0.1)
                    until oldRebirths < LocalPlayer.leaderstats.Rebirths.Value
                    task.wait()
                end
            end)
        end
    end
})

-- ==================== TELEPORT ====================
local teleportLocations = {
    ["Tiny Island"] = CFrame.new(-39.0918, 5.999, 1886.1307),
    ["Frost Island"] = CFrame.new(-2623.022, 5.845, -409.073),
    ["Mythical Island"] = CFrame.new(2250.778, 5.844, 1073.226),
    ["Infernal Island"] = CFrame.new(-6758.963, 5.845, -1284.918),
    ["Legend Island"] = CFrame.new(4603.281, 989.998, -3897.865),
    ["Muscle King"] = CFrame.new(-8625.928, 15.695, -5730.472),
    ["Ancient Jungle Island"] = CFrame.new(-8642.252, 6.275, 2380.506),
}

local selectedTeleport = nil
local teleportDropdown = TabTeleport:Dropdown({
    Title = "Select Teleport",
    Values = {"Tiny Island", "Frost Island", "Mythical Island", "Infernal Island", "Legend Island", "Muscle King", "Ancient Jungle Island"},
    Default = 1,
    Callback = function(selected)
        selectedTeleport = teleportLocations[selected]
    end
})

TabTeleport:Button({
    Title = "Teleport",
    Callback = function()
        if selectedTeleport then
            LocalPlayer.Character:SetPrimaryPartCFrame(selectedTeleport)
        end
    end
})

-- ==================== ROCKS ====================
local rocksSection = TabRocks:Section({ Title = "Rocks", Opened = true })

local punchAnimConn = nil
rocksSection:Toggle({
    Title = "Fast Punch (For Fast Glitch)",
    Desc = "Speeds up punch animation",
    Default = false,
    Callback = function(v)
        if v then
            _G.punchanim = true
            if punchAnimConn then punchAnimConn:Disconnect() end
            punchAnimConn = RunService.Heartbeat:Connect(function()
                if _G.punchanim then
                    local char = LocalPlayer.Character
                    if char then
                        local hum = char:FindFirstChildOfClass("Humanoid")
                        local punch = LocalPlayer.Backpack:FindFirstChild("Punch") or char:FindFirstChild("Punch")
                        if punch then
                            local attack = punch:FindFirstChild("attackTime")
                            if attack then attack.Value = 0 end
                            if hum and punch.Parent ~= char then hum:EquipTool(punch) end
                            punch:Activate()
                        end
                    end
                else
                    if punchAnimConn then punchAnimConn:Disconnect() end
                    punchAnimConn = nil
                end
            end)
        else
            _G.punchanim = false
            if punchAnimConn then punchAnimConn:Disconnect() end
            punchAnimConn = nil
            local punch = LocalPlayer.Backpack:FindFirstChild("Punch") or LocalPlayer.Character:FindFirstChild("Punch")
            if punch and punch:FindFirstChild("attackTime") then
                punch.attackTime.Value = 0.35
            end
        end
    end
})

-- Auto Rocks
local rockNames = {
    ["Ancient Jungle Rock"] = {folder = "Ancient Jungle Rock", size = Vector3.new(23.18, 20.2, 24.44), pos = "originalPosition"},
    ["Muscle King Mountain"] = {folder = "Muscle King Mountain", size = Vector3.new(141.97, 123.69, 149.7)},
    ["Rock Of Legends"] = {folder = "Rock Of Legends", size = Vector3.new(106.04, 92.39, 111.82)},
    ["Inferno Rock"] = {folder = "Inferno Rock", size = Vector3.new(80.68, 70.29, 85.07)},
    ["Mystic Rock"] = {folder = "Mystic Rock", size = Vector3.new(106.04, 92.39, 111.82)},
    ["Frozen Rock"] = {folder = "Frozen Rock", size = Vector3.new(80.68, 70.29, 85.07)},
    ["Tiny Rock"] = {folder = "Tiny Rock", size = Vector3.new(23.18, 20.2, 24.44)},
}

for name, data in pairs(rockNames) do
    local rockActive = false
    local rockVarName = "_" .. name:gsub(" ", "_") .. "_Active"
    rocksSection:Toggle({
        Title = name,
        Desc = "Follows your left hand",
        Default = false,
        Callback = function(v)
            rockActive = v
            _G[rockVarName] = v
            task.spawn(function()
                local leftHand = LocalPlayer.Character and LocalPlayer.Character:WaitForChild("LeftHand")
                local rock = workspace.machinesFolder:FindFirstChild(data.folder) and workspace.machinesFolder[data.folder]:FindFirstChild("Rock")
                while _G[rockVarName] do
                    if rock and leftHand then
                        rock.Size = Vector3.new(2, 1, 1)
                        rock.Transparency = 1
                        for _, child in pairs(rock.rockGui:GetChildren()) do child.Visible = false end
                        rock.CanCollide = false
                        for _, effect in pairs({"rockEmitter", "hoopParticle", "lavaParticle"}) do
                            if rock:FindFirstChild(effect) then rock[effect]:Destroy() end
                        end
                        rock.CFrame = leftHand.CFrame
                    end
                    task.wait()
                end
                pcall(function()
                    if rock then
                        for _, child in pairs(rock.rockGui:GetChildren()) do child.Visible = true end
                        rock.CanCollide = true
                        rock.Transparency = 0
                        rock.CFrame = CFrame.new(rock.originalPosition.Value)
                        rock.Size = data.size
                    end
                end)
            end)
        end
    })
end

-- Rock Farming
local rockFarmOptions = {
    ["Tiny Rock"] = {durability = 0, name = "Tiny Island Rock"},
    ["Starter Rock"] = {durability = 100, name = "Starter Island Rock"},
    ["Legend Beach Rock"] = {durability = 5000, name = "Legend Beach Rock"},
    ["Frozen Rock"] = {durability = 150000, name = "Frost Gym Rock"},
    ["Mythical Rock"] = {durability = 400000, name = "Mythical Gym Rock"},
    ["Eternal Rock"] = {durability = 750000, name = "Eternal Gym Rock"},
    ["Legend Rock"] = {durability = 1000000, name = "Legend Gym Rock"},
    ["Muscle King Rock"] = {durability = 5000000, name = "Muscle King Gym Rock"},
    ["Jungle Rock"] = {durability = 10000000, name = "Ancient Jungle Rock"},
}

local selectedRockFarm = nil
local rockFarmDropdown = TabRocks:Dropdown({
    Title = "Select Rock (Farm)",
    Values = {"Tiny Rock", "Starter Rock", "Legend Beach Rock", "Frozen Rock", "Mythical Rock", "Eternal Rock", "Legend Rock", "Muscle King Rock", "Jungle Rock"},
    Default = 1,
    Callback = function(selected)
        selectedRockFarm = rockFarmOptions[selected]
    end
})

local autoFarmRock = false
TabRocks:Toggle({
    Title = "Farm The Rock",
    Desc = "Auto farm selected rock",
    Default = false,
    Callback = function(v)
        autoFarmRock = v
        task.spawn(function()
            local function punch()
                for _, tool in pairs(LocalPlayer.Backpack:GetChildren()) do
                    if tool.Name == "Punch" and LocalPlayer.Character:FindFirstChild("Humanoid") then
                        LocalPlayer.Character.Humanoid:EquipTool(tool)
                    end
                end
                LocalPlayer.muscleEvent:FireServer("punch", "leftHand")
                LocalPlayer.muscleEvent:FireServer("punch", "rightHand")
            end

            while autoFarmRock do
                task.wait()
                if not autoFarmRock or not selectedRockFarm then break end
                if LocalPlayer.Durability.Value >= selectedRockFarm.durability then
                    for _, obj in pairs(workspace.machinesFolder:GetDescendants()) do
                        if obj.Name == "neededDurability" and obj.Value == selectedRockFarm.durability then
                            local rock = obj.Parent and obj.Parent:FindFirstChild("Rock")
                            if rock and LocalPlayer.Character and LocalPlayer.Character:FindFirstChild("LeftHand") and LocalPlayer.Character:FindFirstChild("RightHand") then
                                firetouchinterest(rock, LocalPlayer.Character.RightHand, 0)
                                firetouchinterest(rock, LocalPlayer.Character.RightHand, 1)
                                firetouchinterest(rock, LocalPlayer.Character.LeftHand, 0)
                                firetouchinterest(rock, LocalPlayer.Character.LeftHand, 1)
                                punch()
                            end
                        end
                    end
                end
            end
        end)
    end
})

-- ==================== FARMV1 ====================
-- ==================== ABA FARMV1 (REORGANIZADA) ====================
local TabFarmV1 = Window:Tab({ Title = "Farm", Icon = "lucide:dumbbell" })

-- Variáveis compartilhadas (mantidas no topo)
local farmLocations = {
    ["Bench Press"] = {
        ["Starter Island"] = CFrame.new(-17, 3.3, -2),
        ["Legend Beach"] = CFrame.new(470, 3.3, -321),
        ["Frost Gym"] = CFrame.new(-3013, 39, -335),
        ["Mythical Gym"] = CFrame.new(2371, 39, 1246),
        ["Eternal Gym"] = CFrame.new(-7176, 45, -1106),
        ["Legend Gym"] = CFrame.new(4111, 1020, -3799),
        ["Muscle King Gym"] = CFrame.new(-8590, 46, -6043),
        ["Jungle Gym"] = CFrame.new(-8173, 64, 1898),
    },
    ["Squat"] = {
        ["Starter Island"] = CFrame.new(-48, 3.3, -11),
        ["Legend Beach"] = CFrame.new(470, 3.3, -321),
        ["Frost Gym"] = CFrame.new(-2933, 29, -579),
        ["Mythical Gym"] = CFrame.new(2489, 3.6, 849),
        ["Eternal Gym"] = CFrame.new(-7176, 45, -1106),
        ["Legend Gym"] = CFrame.new(4304, 987, -4124),
        ["Muscle King Gym"] = CFrame.new(-8940, 13, -5699),
        ["Jungle Gym"] = CFrame.new(-8352, 34, 2878),
    }
}

local selectedBench = "Starter Island"
local selectedSquat = "Starter Island"
local farmingActive = false
local farmThread = nil
local threadCount = 1
local grinding = false
local autoPushups = false
local autoSitups = false
local autoHandstands = false
local autoEatEgg = false

-- Funções auxiliares
local function startFarm(exercise, location)
    local cframe = farmLocations[exercise][location]
    if cframe and LocalPlayer.Character then
        LocalPlayer.Character.HumanoidRootPart.CFrame = cframe
        task.wait(0.5)
        farmingActive = true
        VirtualInputManager:SendKeyEvent(true, "E", false, game)
        task.wait(0.1)
        VirtualInputManager:SendKeyEvent(false, "E", false, game)
        farmThread = task.spawn(function()
            while farmingActive do
                LocalPlayer.muscleEvent:FireServer("rep")
                task.wait()
            end
        end)
    end
end

local function unequipAllPets()
    for _, folder in pairs(LocalPlayer.petsFolder:GetChildren()) do
        if folder:IsA("Folder") then
            for _, pet in pairs(folder:GetChildren()) do
                ReplicatedStorage.rEvents.equipPetEvent:FireServer("unequipPet", pet)
            end
        end
    end
end

-- ==================== SEÇÃO 1: GYM TELEPORTS ====================
local teleportSection = TabFarmV1:Section({ Title = "🏋️ Gym Teleports", Opened = true })

teleportSection:Dropdown({
    Title = "Bench Press Location",
    Values = {"Starter Island", "Legend Beach", "Frost Gym", "Mythical Gym", "Eternal Gym", "Legend Gym", "Muscle King Gym", "Jungle Gym"},
    Default = 1,
    Callback = function(selected) selectedBench = selected end
})

teleportSection:Dropdown({
    Title = "Squat Location",
    Values = {"Starter Island", "Legend Beach", "Frost Gym", "Mythical Gym", "Eternal Gym", "Legend Gym", "Muscle King Gym", "Jungle Gym"},
    Default = 1,
    Callback = function(selected) selectedSquat = selected end
})

teleportSection:Button({
    Title = "Teleport Bench Press",
    Callback = function() startFarm("Bench Press", selectedBench) end
})

teleportSection:Button({
    Title = "Teleport Squat",
    Callback = function() startFarm("Squat", selectedSquat) end
})

teleportSection:Button({
    Title = "⏹️ Stop Farming",
    Callback = function()
        farmingActive = false
        if farmThread then task.cancel(farmThread) end
    end
})

-- ==================== SEÇÃO 2: QUICK TRAVEL ====================
local travelSection = TabFarmV1:Section({ Title = "🚀 Quick Travel", Opened = true })

local quickTps = {
    {"Tiny Island", CFrame.new(-37.1, 9.2, 1919)},
    {"Main Island", CFrame.new(16.07, 9.08, 133.8)},
    {"Beach", CFrame.new(-8, 9, -169.2)},
    {"Muscle King Gym", CFrame.new(-8665.4, 17.21, -5792.9)},
    {"Jungle Gym", CFrame.new(-8543, 6.8, 2400)},
    {"Legends Gym", CFrame.new(4516, 991.5, -3856)},
    {"Infernal Gym", CFrame.new(-6759, 7.36, -1284)},
    {"Mythical Gym", CFrame.new(2250, 7.37, 1073.2)},
    {"Frost Gym", CFrame.new(-2623, 7.36, -409)},
}
for _, tp in pairs(quickTps) do
    travelSection:Button({
        Title = tp[1],
        Callback = function() LocalPlayer.Character:SetPrimaryPartCFrame(tp[2]) end
    })
end

-- ==================== SEÇÃO 3: STRENGTH GRINDING ====================
local grindSection = TabFarmV1:Section({ Title = "💪 Strength Grinding", Opened = true })

grindSection:Input({
    Title = "Rep Threads",
    Placeholder = "Number of threads (default: 1)",
    Callback = function(text)
        local v = tonumber(text)
        if v and v > 0 then threadCount = v end
    end
})

grindSection:Toggle({
    Title = "Start Gaining Strength",
    Desc = "Spams rep with multiple threads",
    Default = false,
    Callback = function(v)
        grinding = v
        if v then
            for i = 1, threadCount do
                task.spawn(function()
                    while grinding do
                        pcall(function() LocalPlayer.muscleEvent:FireServer("rep") end)
                        task.wait(0.01)
                    end
                end)
            end
        end
    end
})

-- ==================== SEÇÃO 4: AUTO EXERCISES ====================
local exerciseSection = TabFarmV1:Section({ Title = "🏃 Auto Exercises", Opened = true })

exerciseSection:Toggle({
    Title = "Auto Pushups",
    Desc = "Equips and uses pushups",
    Default = false,
    Callback = function(v)
        autoPushups = v
        task.spawn(function()
            while autoPushups do
                local backpack = LocalPlayer:FindFirstChild("Backpack")
                local tool = backpack and backpack:FindFirstChild("Pushups")
                if tool then LocalPlayer.Character.Humanoid:EquipTool(tool) end
                LocalPlayer.muscleEvent:FireServer("rep")
                task.wait(0.01)
            end
            if not autoPushups then
                local tool = LocalPlayer.Character:FindFirstChildOfClass("Tool")
                if tool and tool.Name == "Pushups" then tool.Parent = LocalPlayer.Backpack end
            end
        end)
    end
})

exerciseSection:Toggle({
    Title = "Auto Situps",
    Desc = "Equips and uses situps",
    Default = false,
    Callback = function(v)
        autoSitups = v
        task.spawn(function()
            while autoSitups do
                local backpack = LocalPlayer:FindFirstChild("Backpack")
                local tool = backpack and backpack:FindFirstChild("Situps")
                if tool then LocalPlayer.Character.Humanoid:EquipTool(tool) end
                LocalPlayer.muscleEvent:FireServer("rep")
                task.wait(0.01)
            end
            if not autoSitups then
                local tool = LocalPlayer.Character:FindFirstChildOfClass("Tool")
                if tool and tool.Name == "Situps" then tool.Parent = LocalPlayer.Backpack end
            end
        end)
    end
})

exerciseSection:Toggle({
    Title = "Auto Handstands",
    Desc = "Equips and uses handstands",
    Default = false,
    Callback = function(v)
        autoHandstands = v
        task.spawn(function()
            while autoHandstands do
                local backpack = LocalPlayer:FindFirstChild("Backpack")
                local tool = backpack and backpack:FindFirstChild("Handstands")
                if tool then LocalPlayer.Character.Humanoid:EquipTool(tool) end
                LocalPlayer.muscleEvent:FireServer("rep")
                task.wait(0.01)
            end
            if not autoHandstands then
                local tool = LocalPlayer.Character:FindFirstChildOfClass("Tool")
                if tool and tool.Name == "Handstands" then tool.Parent = LocalPlayer.Backpack end
            end
        end)
    end
})

-- ==================== SEÇÃO 5: AUTO MACHINES ====================
local machineSection = TabFarmV1:Section({ Title = "🏛️ Auto Gym Machines", Opened = true })

local jungleBench = false
machineSection:Toggle({
    Title = "Jungle Bench",
    Default = false,
    Callback = function(v)
        jungleBench = v
        task.spawn(function()
            while jungleBench do
                LocalPlayer.Character:SetPrimaryPartCFrame(CFrame.new(-8629.88, 64.88, 1855.03))
                ReplicatedStorage.rEvents.machineInteractRemote:InvokeServer("useMachine", workspace.machinesFolder["Jungle Bench"].interactSeat)
                task.wait(0.1)
            end
        end)
    end
})

local jungleLift = false
machineSection:Toggle({
    Title = "Jungle Bar Lift",
    Default = false,
    Callback = function(v)
        jungleLift = v
        task.spawn(function()
            while jungleLift do
                LocalPlayer.Character:SetPrimaryPartCFrame(CFrame.new(-8678.05, 14.5, 2089.25))
                ReplicatedStorage.rEvents.machineInteractRemote:InvokeServer("useMachine", workspace.machinesFolder["Jungle Bar Lift"].interactSeat)
                task.wait(0.1)
            end
        end)
    end
})

local jungleSquat = false
machineSection:Toggle({
    Title = "Jungle Squat",
    Default = false,
    Callback = function(v)
        jungleSquat = v
        task.spawn(function()
            while jungleSquat do
                LocalPlayer.Character:SetPrimaryPartCFrame(CFrame.new(-8374.25, 34.59, 2932.44))
                ReplicatedStorage.rEvents.machineInteractRemote:InvokeServer("useMachine", workspace.machinesFolder["Jungle Squat"].interactSeat)
                task.wait(0.1)
            end
        end)
    end
})

local kingLift = false
machineSection:Toggle({
    Title = "Muscle King Lift",
    Default = false,
    Callback = function(v)
        kingLift = v
        task.spawn(function()
            while kingLift do
                LocalPlayer.Character:SetPrimaryPartCFrame(CFrame.new(-8772.97, 24.42, -5638.37))
                ReplicatedStorage.rEvents.machineInteractRemote:InvokeServer("useMachine", workspace.machinesFolder["Muscle King Lift"].interactSeat)
                task.wait(0.1)
            end
        end)
    end
})

local kingBoulder = false
machineSection:Toggle({
    Title = "Muscle King Boulder",
    Default = false,
    Callback = function(v)
        kingBoulder = v
        task.spawn(function()
            while kingBoulder do
                LocalPlayer.Character:SetPrimaryPartCFrame(CFrame.new(-8986.61, 30.05, -5647.14))
                ReplicatedStorage.rEvents.machineInteractRemote:InvokeServer("useMachine", workspace.machinesFolder["King Boulder"].interactSeat)
                task.wait(0.1)
            end
        end)
    end
})

local legendLift = false
machineSection:Toggle({
    Title = "Legend Lift",
    Default = false,
    Callback = function(v)
        legendLift = v
        task.spawn(function()
            while legendLift do
                LocalPlayer.Character:SetPrimaryPartCFrame(CFrame.new(4551.51, 997.72, -4018.90))
                ReplicatedStorage.rEvents.machineInteractRemote:InvokeServer("useMachine", workspace.machinesFolder["Legends Lift"].interactSeat)
                task.wait(0.1)
            end
        end)
    end
})

local legendPress = false
machineSection:Toggle({
    Title = "Legend Press",
    Default = false,
    Callback = function(v)
        legendPress = v
        task.spawn(function()
            while legendPress do
                LocalPlayer.Character:SetPrimaryPartCFrame(CFrame.new(4100.08, 1016.20, -3800.41))
                ReplicatedStorage.rEvents.machineInteractRemote:InvokeServer("useMachine", workspace.machinesFolder["Legends Press"].interactSeat)
                task.wait(0.1)
            end
        end)
    end
})

-- ==================== SEÇÃO 6: ROCK COMBOS ====================
local rockComboSection = TabFarmV1:Section({ Title = "🪨 Auto Rock Combos", Opened = true })

rockComboSection:Toggle({
    Title = "Pushups + Ancient Jungle Rock",
    Desc = "Combines pushups with jungle rock",
    Default = false,
    Callback = function(v)
        if v then
            local leftHand = LocalPlayer.Character:WaitForChild("LeftHand")
            local rock = workspace.machinesFolder:FindFirstChild("Ancient Jungle Rock") and workspace.machinesFolder["Ancient Jungle Rock"]:FindFirstChild("Rock")
            _G.jungleautorock = true
            autoPushups = true
            task.spawn(function()
                while _G.jungleautorock do
                    if rock then
                        rock.Size = Vector3.new(2,1,1)
                        rock.Transparency = 1
                        for _, child in pairs(rock.rockGui:GetChildren()) do child.Visible = false end
                        rock.CanCollide = false
                        for _, effect in pairs({"rockEmitter","hoopParticle","lavaParticle"}) do
                            if rock:FindFirstChild(effect) then rock[effect]:Destroy() end
                        end
                        rock.CFrame = leftHand.CFrame
                    end
                    wait()
                end
            end)
            task.spawn(function()
                while autoPushups do
                    local backpack = LocalPlayer:FindFirstChild("Backpack")
                    local tool = backpack and backpack:FindFirstChild("Pushups")
                    if tool then LocalPlayer.Character.Humanoid:EquipTool(tool) end
                    LocalPlayer.muscleEvent:FireServer("rep")
                    task.wait(0.01)
                end
            end)
        else
            _G.jungleautorock = false
            autoPushups = false
            local rock = workspace.machinesFolder:FindFirstChild("Ancient Jungle Rock") and workspace.machinesFolder["Ancient Jungle Rock"]:FindFirstChild("Rock")
            if rock then
                for _, child in pairs(rock.rockGui:GetChildren()) do child.Visible = true end
                rock.CanCollide = true
                rock.Transparency = 0
                rock.CFrame = CFrame.new(rock.originalPosition.Value)
                rock.Size = Vector3.new(23.18, 20.2, 24.44)
            end
            local tool = LocalPlayer.Character:FindFirstChildOfClass("Tool")
            if tool and tool.Name == "Pushups" then tool.Parent = LocalPlayer.Backpack end
        end
    end
})

rockComboSection:Toggle({
    Title = "Pushups + Muscle King Rock",
    Desc = "Combines pushups with king rock",
    Default = false,
    Callback = function(v)
        if v then
            local leftHand = LocalPlayer.Character:WaitForChild("LeftHand")
            local rock = workspace.machinesFolder:FindFirstChild("Muscle King Mountain") and workspace.machinesFolder["Muscle King Mountain"]:FindFirstChild("Rock")
            _G.musclekingautorock = true
            autoPushups = true
            task.spawn(function()
                while _G.musclekingautorock do
                    if rock then
                        rock.Size = Vector3.new(2,1,1)
                        rock.Transparency = 1
                        for _, child in pairs(rock.rockGui:GetChildren()) do child.Visible = false end
                        rock.CanCollide = false
                        for _, effect in pairs({"rockEmitter","hoopParticle","lavaParticle"}) do
                            if rock:FindFirstChild(effect) then rock[effect]:Destroy() end
                        end
                        rock.CFrame = leftHand.CFrame
                    end
                    wait()
                end
            end)
            task.spawn(function()
                while autoPushups do
                    local backpack = LocalPlayer:FindFirstChild("Backpack")
                    local tool = backpack and backpack:FindFirstChild("Pushups")
                    if tool then LocalPlayer.Character.Humanoid:EquipTool(tool) end
                    LocalPlayer.muscleEvent:FireServer("rep")
                    task.wait(0.01)
                end
            end)
        else
            _G.musclekingautorock = false
            autoPushups = false
            local rock = workspace.machinesFolder:FindFirstChild("Muscle King Mountain") and workspace.machinesFolder["Muscle King Mountain"]:FindFirstChild("Rock")
            if rock then
                for _, child in pairs(rock.rockGui:GetChildren()) do child.Visible = true end
                rock.CanCollide = true
                rock.Transparency = 0
                rock.CFrame = CFrame.new(rock.originalPosition.Value)
                rock.Size = Vector3.new(141.97, 123.69, 149.7)
            end
            local tool = LocalPlayer.Character:FindFirstChildOfClass("Tool")
            if tool and tool.Name == "Pushups" then tool.Parent = LocalPlayer.Backpack end
        end
    end
})

-- ==================== SEÇÃO 7: UTILITIES ====================
local utilitySection = TabFarmV1:Section({ Title = "🛠️ Utilities", Opened = true })

utilitySection:Toggle({
    Title = "Eat Egg (30 Min)",
    Desc = "Uses Protein Egg every 30 minutes",
    Default = false,
    Callback = function(v)
        autoEatEgg = v
        task.spawn(function()
            while autoEatEgg do
                local backpack = LocalPlayer:FindFirstChild("Backpack")
                local egg = backpack and backpack:FindFirstChild("Protein Egg")
                if egg then
                    egg.Parent = LocalPlayer.Character
                    pcall(function() egg:Activate() end)
                end
                task.wait(1800)
            end
        end)
    end
})

-- Equip pets
local petTypes = {"Swift Samurai", "Tribal Overlord", "Mighty Monster", "Wild Wizard"}
for _, petName in pairs(petTypes) do
    utilitySection:Button({
        Title = "Equip All " .. petName,
        Callback = function()
            unequipAllPets()
            for _, pet in pairs(LocalPlayer.petsFolder.Unique:GetChildren()) do
                if pet.Name == petName then
                    ReplicatedStorage.rEvents.equipPetEvent:FireServer("equipPet", pet)
                end
            end
        end
    })
end

utilitySection:Button({
    Title = "Anti-Lag",
    Callback = function()
        for _, gui in pairs(LocalPlayer.PlayerGui:GetChildren()) do
            if gui:IsA("ScreenGui") then gui:Destroy() end
        end
        for _, obj in pairs(workspace:GetDescendants()) do
            if obj:IsA("ParticleEmitter") then obj:Destroy() end
            if obj:IsA("PointLight") or obj:IsA("SpotLight") or obj:IsA("SurfaceLight") then obj:Destroy() end
        end
        for _, effect in pairs(Lighting:GetChildren()) do
            if effect:IsA("Sky") then effect:Destroy() end
        end
        local sky = Instance.new("Sky")
        sky.Name = "DarkSky"
        sky.SkyboxBk = "rbxassetid://0"
        sky.SkyboxDn = "rbxassetid://0"
        sky.SkyboxFt = "rbxassetid://0"
        sky.SkyboxLf = "rbxassetid://0"
        sky.SkyboxRt = "rbxassetid://0"
        sky.SkyboxUp = "rbxassetid://0"
        sky.Parent = Lighting
        Lighting.Brightness = 0
        Lighting.ClockTime = 0
        Lighting.OutdoorAmbient = Color3.new(0,0,0)
        Lighting.Ambient = Color3.new(0,0,0)
        Lighting.FogColor = Color3.new(0,0,0)
        Lighting.FogEnd = 100
        task.spawn(function()
            while true do
                wait(5)
                if not Lighting:FindFirstChild("DarkSky") then sky:Clone().Parent = Lighting end
                Lighting.Brightness = 0
                Lighting.ClockTime = 0
                Lighting.OutdoorAmbient = Color3.new(0,0,0)
                Lighting.Ambient = Color3.new(0,0,0)
                Lighting.FogColor = Color3.new(0,0,0)
                Lighting.FogEnd = 100
            end
        end)
    end
})

-- ==================== PETS HATCH ====================
local petNames = {
    "Neon Guardian", "Blue Birdie", "Blue Bunny", "Blue Firecaster", "Blue Phoenix",
    "Crimson Falcon", "Cybernetic Showdown Dragon", "Dark Golem", "Dark Legends Manticore",
    "Dark Vampy", "Darkstar Hunter", "Eternal Strike Leviathan", "Frostwave Legends Penguin",
    "Gold Warrior", "Golden Phoenix", "Golden Viking", "Green Butterfly", "Green Firecaster",
    "Infernal Dragon", "Lightning Strike Phantom", "Magic Butterfly", "Muscle Sensei",
    "Orange Hedgehog", "Orange Pegasus", "Phantom Genesis Dragon", "Purple Dragon",
    "Purple Falcon", "Red Dragon", "Red Firecaster", "Red Kitty", "Silver Dog",
    "Ultimate Supernova Pegasus", "Ultra Birdie", "White Pegasus", "White Phoenix", "Yellow Butterfly"
}
local selectedPet = petNames[1]
local petDropdown = TabPets:Dropdown({
    Title = "Select Pet",
    Values = petNames,
    Default = 1,
    Callback = function(selected) selectedPet = selected end
})

local autoHatchPet = false
TabPets:Toggle({
    Title = "Auto Open Pet",
    Desc = "Auto hatches selected pet",
    Default = false,
    Callback = function(v)
        autoHatchPet = v
        task.spawn(function()
            while autoHatchPet do
                local pet = ReplicatedStorage.cPetShopFolder:FindFirstChild(selectedPet)
                if pet then ReplicatedStorage.cPetShopRemote:InvokeServer(pet) end
                task.wait(1)
            end
        end)
    end
})

-- Auras
local auraNames = {
    "Astral Electro", "Azure Tundra", "Blue Aura", "Dark Electro", "Dark Lightning",
    "Dark Storm", "Electro", "Enchanted Mirage", "Entropic Blast", "Eternal Megastrike",
    "Grand Supernova", "Green Aura", "Inferno", "Lightning", "Muscle King",
    "Power Lightning", "Purple Aura", "Purple Nova", "Red Aura", "Supernova",
    "Ultra Inferno", "Ultra Mirage", "Unstable Mirage", "Yellow Aura"
}
local selectedAura = auraNames[1]
local auraDropdown = TabPets:Dropdown({
    Title = "Select Aura",
    Values = auraNames,
    Default = 1,
    Callback = function(selected) selectedAura = selected end
})

local autoHatchAura = false
TabPets:Toggle({
    Title = "Auto Open Aura",
    Default = false,
    Callback = function(v)
        autoHatchAura = v
        task.spawn(function()
            while autoHatchAura do
                local aura = ReplicatedStorage.cPetShopFolder:FindFirstChild(selectedAura)
                if aura then ReplicatedStorage.cPetShopRemote:InvokeServer(aura) end
                task.wait(1)
            end
        end)
    end
})

-- Crystals
local crystalNames = {
    "Blue Crystal", "Green Crystal", "Frozen Crystal", "Mythical Crystal",
    "Inferno Crystal", "Legends Crystal", "Muscle Elite Crystal",
    "Galaxy Oracle Crystal", "Sky Eclipse Crystal", "Jungle Crystal"
}
local selectedCrystal = crystalNames[1]
local crystalDropdown = TabPets:Dropdown({
    Title = "Select Crystal",
    Values = crystalNames,
    Default = 1,
    Callback = function(selected) selectedCrystal = selected end
})

local autoOpenCrystal = false
TabPets:Toggle({
    Title = "Auto Open Crystal",
    Default = false,
    Callback = function(v)
        autoOpenCrystal = v
        task.spawn(function()
            while autoOpenCrystal do
                ReplicatedStorage.rEvents.openCrystalRemote:InvokeServer("openCrystal", selectedCrystal)
                task.wait(0.1)
            end
        end)
    end
})

-- Sell pet
local sellPetName = ""
TabPets:Input({
    Title = "Pet Name",
    Placeholder = "Type pet name",
    Callback = function(text) sellPetName = text end
})

TabPets:Button({
    Title = "Sell Pet (Click Everytime To Sell)",
    Callback = function()
        if sellPetName ~= "" then
            ReplicatedStorage.rEvents.sellPetEvent:FireServer("sellPet", sellPetName)
        end
    end
})

-- ==================== KILLING ====================
local killSection = TabKilling:Section({ Title = "Killing", Opened = true })

killSection:Paragraph({ Title = "Use Pack Pets For Killing Enhancer" })
local killPetTypes = {"Mighty Monster", "Wild Wizard"}
for _, pet in pairs(killPetTypes) do
    killSection:Button({
        Title = "Equip For " .. (pet == "Mighty Monster" and "Durability" or "Damage"),
        Callback = function()
            unequipAllPets()
            for _, p in pairs(LocalPlayer.petsFolder.Unique:GetChildren()) do
                if p.Name == pet then
                    ReplicatedStorage.rEvents.equipPetEvent:FireServer("equipPet", p)
                end
            end
        end
    })
end

killSection:Paragraph({ Title = "----------" })

local autoPunch = false
killSection:Toggle({
    Title = "Auto Punch",
    Default = false,
    Callback = function(v)
        autoPunch = v
        if v then
            local punch = LocalPlayer.Backpack:FindFirstChild("Punch") or LocalPlayer.Character:FindFirstChild("Punch")
            _G.punchanim = true
            task.spawn(function()
                while _G.punchanim do
                    if punch then
                        if punch.Parent ~= LocalPlayer.Character then
                            punch.Parent = LocalPlayer.Character
                        end
                        punch:Activate()
                        wait()
                    else
                        _G.punchanim = false
                    end
                end
            end)
        else
            _G.punchanim = false
        end
    end
})

local fastPunch = false
killSection:Toggle({
    Title = "Fast Punch",
    Desc = "Sets attackTime to 0",
    Default = false,
    Callback = function(v)
        fastPunch = v
        local punch = LocalPlayer.Backpack:FindFirstChild("Punch") or LocalPlayer.Character:FindFirstChild("Punch")
        if punch and punch:FindFirstChild("attackTime") then
            punch.attackTime.Value = v and 0.0001 or 0.35
        end
    end
})

-- Server Hop Killing
killSection:Button({
    Title = "Server Hop Killing",
    Callback = function()
        -- Load external server hop script (preserved from original)
        loadstring(game:HttpGet("https://pastebin.com/raw/CjNsnSDy"))() -- placeholder; in original it's a complex UI
        -- Nota: essa funcionalidade era complexa, simplifiquei para carregar o script externo
    end
})

-- Auto Kill methods
local killMethod = "Non-Teleport"
killSection:Dropdown({
    Title = "Select Kill Method",
    Values = {"Teleport", "Non-Teleport"},
    Default = 2,
    Callback = function(selected) killMethod = selected end
})

local autoKillActive = false
killSection:Toggle({
    Title = "Auto Kill Everyone",
    Default = false,
    Callback = function(v)
        autoKillActive = v
        if v then
            if killMethod == "Teleport" then
                task.spawn(function()
                    while autoKillActive do
                        local char = LocalPlayer.Character
                        if char then
                            local root = char:FindFirstChild("HumanoidRootPart")
                            local punch = char:FindFirstChild("Punch")
                            if punch then punch:Activate() end
                            for _, player in pairs(Players:GetPlayers()) do
                                if player ~= LocalPlayer then
                                    pcall(function()
                                        local targetRoot = player.Character and player.Character:FindFirstChild("HumanoidRootPart")
                                        if targetRoot then
                                            targetRoot.Size = Vector3.new(20,20,20)
                                            targetRoot.Transparency = 1
                                            targetRoot.CanCollide = false
                                            targetRoot.CFrame = CFrame.new(1953.2662, 1.7816, 6186.1226)
                                        end
                                    end)
                                end
                            end
                            if root then root.CFrame = CFrame.new(1953.2662, 1.7816, 6186.1226) end
                            LocalPlayer.muscleEvent:FireServer("punch", "rightHand")
                            LocalPlayer.muscleEvent:FireServer("punch", "leftHand")
                        end
                        wait(0.01)
                    end
                end)
            else
                -- Non-Teleport
                task.spawn(function()
                    while autoKillActive do
                        local char = LocalPlayer.Character
                        if char then
                            local left = char:FindFirstChild("LeftHand")
                            local right = char:FindFirstChild("RightHand")
                            for _, player in pairs(Players:GetPlayers()) do
                                if player ~= LocalPlayer then
                                    local target = player.Character and player.Character:FindFirstChild("Head")
                                    if target and left and right then
                                        target.CFrame = left.CFrame
                                        for _, part in pairs(player.Character:GetDescendants()) do
                                            if part:IsA("BasePart") and part.Name == "Handle" then
                                                part.CFrame = left.CFrame
                                            end
                                        end
                                        local sweat = player.Character:FindFirstChild("sweatPart")
                                        if sweat then sweat.CFrame = left.CFrame end
                                    end
                                end
                            end
                            LocalPlayer.muscleEvent:FireServer("punch", "rightHand")
                            LocalPlayer.muscleEvent:FireServer("punch", "leftHand")
                        end
                        wait(0.01)
                    end
                end)
            end
        end
    end
})

local whitelist = {}
local whitelistDropdown = killSection:Dropdown({
    Title = "Whitelist Players",
    Values = {"None"},
    Default = 1,
    Callback = function(selected)
        if selected ~= "None" then
            if table.find(whitelist, selected) then
                for i, v in pairs(whitelist) do
                    if v == selected then
                        table.remove(whitelist, i)
                        break
                    end
                end
            else
                table.insert(whitelist, selected)
            end
        end
    end
})

-- Populate whitelist dropdown (corrigido)
task.spawn(function()
    local names = {}
    for _, p in pairs(Players:GetPlayers()) do
        if p ~= LocalPlayer then
            table.insert(names, p.Name)
        end
    end
    table.insert(names, 1, "None")  -- "None" sempre no topo

    -- Limpa as opções atuais e adiciona todas de uma vez
    whitelistDropdown:Clear()
    for _, nome in ipairs(names) do
        whitelistDropdown:Add(nome)
    end
    -- Define a seleção como "None" (índice 1)
    whitelistDropdown:SetValue(1)  -- se existir; senão, apenas o Default já está 1
end)

-- Auto Kill V2
local autoKillV2 = false
killSection:Toggle({
    Title = "Auto Kill V2",
    Default = false,
    Callback = function(v)
        autoKillV2 = v
        task.spawn(function()
            while autoKillV2 do
                local char = LocalPlayer.Character
                local left = char and char:FindFirstChild("LeftHand")
                local right = char and char:FindFirstChild("RightHand")
                local punch = LocalPlayer.Backpack:FindFirstChild("Punch")
                if punch and not char:FindFirstChild("Punch") then punch.Parent = char end
                if left and right then
                    for _, player in pairs(Players:GetPlayers()) do
                        if player ~= LocalPlayer and not table.find(whitelist, player.Name) then
                            local target = player.Character and player.Character:FindFirstChild("HumanoidRootPart")
                            if target then
                                pcall(function()
                                    firetouchinterest(left, target, 1)
                                    firetouchinterest(right, target, 1)
                                    firetouchinterest(left, target, 0)
                                    firetouchinterest(right, target, 0)
                                end)
                            end
                        end
                    end
                end
                task.wait(0.05)
            end
        end)
    end
})

-- Good/Bad Karma
local autoGoodKarma = false
killSection:Toggle({
    Title = "Auto Good Karma",
    Default = false,
    Callback = function(v)
        autoGoodKarma = v
        task.spawn(function()
            while autoGoodKarma do
                local char = LocalPlayer.Character
                local left = char and char:FindFirstChild("LeftHand")
                local right = char and char:FindFirstChild("RightHand")
                if left and right then
                    for _, player in pairs(Players:GetPlayers()) do
                        if player ~= LocalPlayer then
                            local evil = player:FindFirstChild("evilKarma")
                            local good = player:FindFirstChild("goodKarma")
                            if evil and good and evil.Value > good.Value then
                                local target = player.Character and player.Character:FindFirstChild("HumanoidRootPart")
                                if target then
                                    firetouchinterest(left, target, 1)
                                    firetouchinterest(right, target, 1)
                                    firetouchinterest(left, target, 0)
                                    firetouchinterest(right, target, 0)
                                end
                            end
                        end
                    end
                end
                task.wait(0.1)
            end
        end)
    end
})

local autoBadKarma = false
killSection:Toggle({
    Title = "Auto Bad Karma",
    Default = false,
    Callback = function(v)
        autoBadKarma = v
        task.spawn(function()
            while autoBadKarma do
                local char = LocalPlayer.Character
                local left = char and char:FindFirstChild("LeftHand")
                local right = char and char:FindFirstChild("RightHand")
                if left and right then
                    for _, player in pairs(Players:GetPlayers()) do
                        if player ~= LocalPlayer then
                            local evil = player:FindFirstChild("evilKarma")
                            local good = player:FindFirstChild("goodKarma")
                            if evil and good and good.Value > evil.Value then
                                local target = player.Character and player.Character:FindFirstChild("HumanoidRootPart")
                                if target then
                                    firetouchinterest(left, target, 1)
                                    firetouchinterest(right, target, 1)
                                    firetouchinterest(left, target, 0)
                                    firetouchinterest(right, target, 0)
                                end
                            end
                        end
                    end
                end
                task.wait(0.1)
            end
        end)
    end
})

-- Select Pet Type
local selectedKillPet = "Mighty Monster"
killSection:Dropdown({
    Title = "Select Pet Type",
    Values = {"Mighty Monster", "Wild Wizard"},
    Default = 1,
    Callback = function(selected)
        selectedKillPet = selected
        unequipAllPets()
        for _, p in pairs(LocalPlayer.petsFolder.Unique:GetChildren()) do
            if p.Name == selected then
                ReplicatedStorage.rEvents.equipPetEvent:FireServer("equipPet", p)
            end
        end
    end
})

-- NaN Size Combo
local allAutoActive = false
killSection:Toggle({
    Title = "NaN Size Combo",
    Desc = "Enable all automation features at once!",
    Default = false,
    Callback = function(v)
        allAutoActive = v
        if v then
            -- Auto Protein Egg + NaN size etc. (simplified)
            task.spawn(function()
                while allAutoActive do
                    local backpack = LocalPlayer:FindFirstChild("Backpack")
                    local egg = backpack and backpack:FindFirstChild("Protein Egg")
                    if egg then
                        egg.Parent = LocalPlayer.Character
                        pcall(function() egg:Activate() end)
                    end
                    LocalPlayer.muscleEvent:FireServer("punch", "rightHand")
                    ReplicatedStorage.rEvents.changeSpeedSizeRemote:InvokeServer("changeSize", math.huge * 0)
                    if LocalPlayer.Character and LocalPlayer.Character:FindFirstChild("HumanoidRootPart") then
                        LocalPlayer.Character.HumanoidRootPart.CFrame = CFrame.new(-20.64, 3.68, 136.23)
                    end
                    task.wait(0.001)
                end
            end)
        end
    end
})

killSection:Toggle({
    Title = "Anti Knockback [Important]",
    Default = false,
    Callback = function(v)
        if v then
            local cframe = LocalPlayer.Character.HumanoidRootPart.CFrame
            getgenv().posLock = RunService.Heartbeat:Connect(function()
                if LocalPlayer.Character:FindFirstChild("HumanoidRootPart") then
                    LocalPlayer.Character.HumanoidRootPart.CFrame = cframe
                end
            end)
        else
            if getgenv().posLock then
                getgenv().posLock:Disconnect()
                getgenv().posLock = nil
            end
        end
    end
})

-- Fast Punch (repeated from rocks, but for killing)
local fastPunch2 = false
killSection:Toggle({
    Title = "Fast Punch (Killing)",
    Default = false,
    Callback = function(v)
        fastPunch2 = v
        if v then
            _G.punchanim = true
            if punchAnimConn then punchAnimConn:Disconnect() end
            punchAnimConn = RunService.Heartbeat:Connect(function()
                if _G.punchanim then
                    local char = LocalPlayer.Character
                    if char then
                        local hum = char:FindFirstChildOfClass("Humanoid")
                        local punch = LocalPlayer.Backpack:FindFirstChild("Punch") or char:FindFirstChild("Punch")
                        if punch then
                            local attack = punch:FindFirstChild("attackTime")
                            if attack then attack.Value = 0 end
                            if hum and punch.Parent ~= char then hum:EquipTool(punch) end
                            punch:Activate()
                        end
                    end
                else
                    if punchAnimConn then punchAnimConn:Disconnect() end
                    punchAnimConn = nil
                end
            end)
        else
            _G.punchanim = false
            if punchAnimConn then punchAnimConn:Disconnect() end
            punchAnimConn = nil
        end
    end
})

-- Auto Kill Player (targeted)
local targetPlayerName = ""
killSection:Input({
    Title = "Target Player Name",
    Placeholder = "Enter name",
    Callback = function(text) targetPlayerName = text end
})

local targetedKill = false
killSection:Toggle({
    Title = "Auto Kill Player [ENABLE PUNCH]",
    Default = false,
    Callback = function(v)
        targetedKill = v
        task.spawn(function()
            while targetedKill and targetPlayerName ~= "" do
                local target = Players:FindFirstChild(targetPlayerName)
                if target and target ~= LocalPlayer then
                    local root = target.Character and target.Character:FindFirstChild("HumanoidRootPart")
                    if root then
                        local char = LocalPlayer.Character
                        if char then
                            local left = char:FindFirstChild("LeftHand")
                            local right = char:FindFirstChild("RightHand")
                            if left and right then
                                firetouchinterest(left, root, 1)
                                firetouchinterest(right, root, 1)
                                firetouchinterest(left, root, 0)
                                firetouchinterest(right, root, 0)
                            end
                        end
                    end
                end
                task.wait(0.1)
            end
        end)
    end
})

-- Spy Player
local spyActive = false
killSection:Toggle({
    Title = "Spy Player",
    Default = false,
    Callback = function(v)
        spyActive = v
        if v and targetPlayerName ~= "" then
            local target = Players:FindFirstChild(targetPlayerName)
            if target then
                Camera.CameraType = Enum.CameraType.Scriptable
                task.spawn(function()
                    while spyActive do
                        local root = target.Character and target.Character:FindFirstChild("HumanoidRootPart")
                        if root then
                            Camera.CFrame = CFrame.new(root.Position + Vector3.new(0,5,10), root.Position)
                        end
                        task.wait()
                    end
                    Camera.CameraType = Enum.CameraType.Custom
                    Camera.CameraSubject = LocalPlayer.Character and LocalPlayer.Character:FindFirstChildOfClass("Humanoid")
                end)
            end
        else
            Camera.CameraType = Enum.CameraType.Custom
            Camera.CameraSubject = LocalPlayer.Character and LocalPlayer.Character:FindFirstChildOfClass("Humanoid")
        end
    end
})

-- ==================== ULTIMATES ====================
local ultimateNames = {
    "RepSpeed", "PetSlot", "ItemCapacity", "DailySpin", "ChestRewards",
    "QuestRewards", "MuscleMind", "JungleSwift", "InfernalHealth",
    "GalaxyGains", "DemonDamage", "GoldenRebirth"
}
local selectedUltimate = ultimateNames[1]
TabUltimates:Dropdown({
    Title = "Upgrade Ultimate",
    Values = ultimateNames,
    Default = 1,
    Callback = function(selected) selectedUltimate = selected end
})

TabUltimates:Toggle({
    Title = "Buy Selected Ultimate",
    Default = false,
    Callback = function(v)
        if v then
            ReplicatedStorage.rEvents.ultimatesRemote:InvokeServer("upgradeUltimate", selectedUltimate)
        end
    end
})

-- ==================== STATS ====================
local statsSection = TabStats:Section({ Title = "Execution Stats", Opened = true })
local startTime = tick()
local initialStats = {
    Strength = LocalPlayer.leaderstats.Strength.Value,
    Durability = LocalPlayer.Durability.Value,
    Agility = LocalPlayer.Agility.Value,
    Kills = LocalPlayer.leaderstats.Kills.Value,
    EvilKarma = LocalPlayer.evilKarma.Value,
    GoodKarma = LocalPlayer.goodKarma.Value,
}

local function updateStats()
    local elapsed = tick() - startTime
    local mins = math.floor(elapsed / 60)
    local secs = math.floor(elapsed % 60)
    local timeText = string.format("%02d:%02d", mins, secs)

    local str = LocalPlayer.leaderstats.Strength.Value
    local dur = LocalPlayer.Durability.Value
    local agi = LocalPlayer.Agility.Value
    local kills = LocalPlayer.leaderstats.Kills.Value
    local evil = LocalPlayer.evilKarma.Value
    local good = LocalPlayer.goodKarma.Value

    local gained = {
        Strength = str - initialStats.Strength,
        Durability = dur - initialStats.Durability,
        Agility = agi - initialStats.Agility,
        Kills = kills - initialStats.Kills,
        EvilKarma = evil - initialStats.EvilKarma,
        GoodKarma = good - initialStats.GoodKarma,
    }

    return string.format([[
Execution Time: %s
Strength Gained: %s
Durability Gained: %s
Agility Gained: %s
Kills Gained: %s
Evil Karma: %s
Good Karma: %s
]], timeText,
abbreviateNumber(gained.Strength),
abbreviateNumber(gained.Durability),
abbreviateNumber(gained.Agility),
abbreviateNumber(gained.Kills),
abbreviateNumber(gained.EvilKarma),
abbreviateNumber(gained.GoodKarma))
end

local statsLabel = statsSection:Paragraph({ Title = "Live Stats", Text = updateStats() })
task.spawn(function()
    while task.wait(0.5) do
        statsLabel.Text = updateStats()   -- AGORA FUNCIONA!
    end
end)

-- ==================== VIEW STATS ====================
local viewStatsSection = TabViewStats:Section({ Title = "Player Stats Viewer", Opened = true })
local viewedPlayer = nil
local viewPlayerDropdown = viewStatsSection:Dropdown({
    Title = "Select Player",
    Values = {"None"},
    Default = 1,
    Callback = function(selected)
        viewedPlayer = Players:FindFirstChild(selected)
    end
})

-- Populate dropdown (corrigido)
task.spawn(function()
    local names = {"None"}
    for _, p in pairs(Players:GetPlayers()) do
        if p ~= LocalPlayer then
            table.insert(names, p.Name)
        end
    end

    -- Limpa as opções atuais e recarrega
    viewPlayerDropdown:Clear()
    for _, nome in ipairs(names) do
        viewPlayerDropdown:Add(nome)
    end
    -- Define a seleção como "None" (índice 1)
    viewPlayerDropdown:SetValue(1)
end)

local function getPlayerStatsText()
    if not viewedPlayer then return "No player selected" end
    local ls = viewedPlayer:FindFirstChild("leaderstats")
    if not ls then return "Player has no leaderstats" end
    local str = ls:FindFirstChild("Strength") and abbreviateNumber(ls.Strength.Value) or "0"
    local dur = viewedPlayer:FindFirstChild("Durability") and abbreviateNumber(viewedPlayer.Durability.Value) or "0"
    local agi = viewedPlayer:FindFirstChild("Agility") and abbreviateNumber(viewedPlayer.Agility.Value) or "0"
    local reb = ls:FindFirstChild("Rebirths") and abbreviateNumber(ls.Rebirths.Value) or "0"
    local kills = ls:FindFirstChild("Kills") and abbreviateNumber(ls.Kills.Value) or "0"
    local evil = viewedPlayer:FindFirstChild("evilKarma") and abbreviateNumber(viewedPlayer.evilKarma.Value) or "0"
    local good = viewedPlayer:FindFirstChild("goodKarma") and abbreviateNumber(viewedPlayer.goodKarma.Value) or "0"
    return string.format([[
Stats for %s:
💪 Strength: %s
🛡️ Durability: %s
🏃 Agility: %s
🔄 Rebirths: %s
💀 Kills: %s
😈 Evil Karma: %s
😇 Good Karma: %s
]], viewedPlayer.DisplayName, str, dur, agi, reb, kills, evil, good)
end

local viewStatsLabel = viewStatsSection:Paragraph({ Title = "Player Stats", Text = "Select a player" })
task.spawn(function()
    while task.wait(0.5) do
        if viewedPlayer then
            viewStatsLabel:SetText(getPlayerStatsText())
        end
    end
end)

-- ==================== MISC ====================
local miscSection = TabMisc:Section({ Title = "Miscellaneous", Opened = true })

-- Brawl God Mode
local brawlGodMode = false
miscSection:Toggle({
    Title = "God Mode (Brawl)",
    Default = false,
    Callback = function(v)
        brawlGodMode = v
        task.spawn(function()
            while brawlGodMode do
                ReplicatedStorage.rEvents.brawlEvent:FireServer("joinBrawl")
                task.wait(0)
            end
        end)
    end
})

-- Auto Join Brawl
local autoJoinBrawl = false
miscSection:Toggle({
    Title = "Auto Join Brawl",
    Default = false,
    Callback = function(v)
        autoJoinBrawl = v
        task.spawn(function()
            while autoJoinBrawl do
                ReplicatedStorage.rEvents.brawlEvent:FireServer("joinBrawl")
                task.wait(2)
            end
        end)
    end
})

-- Destroy Ad Teleport
miscSection:Button({
    Title = "Destroy Ad Teleport",
    Callback = function()
        local portals = workspace:FindFirstChild("RobloxForwardPortals")
        if portals then portals:Destroy() end
    end
})

-- Permanent Shift Lock
miscSection:Button({
    Title = "Permanent Shift Lock",
    Callback = function()
        loadstring(game:HttpGet("https://pastebin.com/raw/CjNsnSDy"))()
    end
})

-- Anti AFK
miscSection:Button({
    Title = "Anti AFK",
    Callback = function()
        loadstring(game:HttpGet("https://raw.githubusercontent.com/evxncodes/mainroblox/main/anti-afk", true))()
    end
})

-- Disable/Enable Trade
miscSection:Toggle({
    Title = "Disable Trade",
    Default = false,
    Callback = function(v)
        if v then
            ReplicatedStorage.rEvents.tradingEvent:FireServer("disableTrading")
        else
            ReplicatedStorage.rEvents.tradingEvent:FireServer("enableTrading")
        end
    end
})

-- Hide Pets
miscSection:Toggle({
    Title = "Hide Pets",
    Default = false,
    Callback = function(v)
        if v then
            ReplicatedStorage.rEvents.showPetsEvent:FireServer("hidePets")
        else
            ReplicatedStorage.rEvents.showPetsEvent:FireServer("showPets")
        end
    end
})

-- Auto Lift
local autoLift = false
miscSection:Toggle({
    Title = "Auto Lift",
    Default = false,
    Callback = function(v)
        autoLift = v
        task.spawn(function()
            while autoLift do
                LocalPlayer.muscleEvent:FireServer("rep")
                task.wait(0.1)
            end
        end)
    end
})

-- Stats Changer V1
miscSection:Button({
    Title = "Stats Changer V1",
    Callback = function()
        -- Simplified version of the stats changer UI
        local gui = Instance.new("ScreenGui")
        gui.Parent = game.CoreGui
        local frame = Instance.new("Frame")
        frame.Size = UDim2.new(0, 300, 0, 300)
        frame.Position = UDim2.new(0.5, -150, 0.5, -150)
        frame.BackgroundColor3 = Color3.new(0,0,0)
        frame.BackgroundTransparency = 0.5
        frame.Parent = gui
        local corner = Instance.new("UICorner", frame)
        corner.CornerRadius = UDim.new(0, 15)

        local title = Instance.new("TextLabel", frame)
        title.Size = UDim2.new(1, 0, 0, 30)
        title.Text = "STATS CHANGER"
        title.TextColor3 = Color3.new(1,1,1)
        title.BackgroundTransparency = 1
        title.Font = Enum.Font.SourceSansBold
        title.TextScaled = true

        local stats = {"Strength", "Rebirths", "Kills", "Brawls"}
        for i, name in ipairs(stats) do
            local textbox = Instance.new("TextBox", frame)
            textbox.Size = UDim2.new(0, 250, 0, 30)
            textbox.Position = UDim2.new(0.1, 0, 0.1 + 0.2 * (i-1), 0)
            textbox.BackgroundColor3 = Color3.new(0.2,0.2,0.2)
            textbox.TextColor3 = Color3.new(1,1,1)
            textbox.Font = Enum.Font.SourceSans
            textbox.PlaceholderText = "Change " .. name
            textbox.PlaceholderColor3 = Color3.new(0.7,0.7,0.7)
            textbox.ClearTextOnFocus = false
            local stroke = Instance.new("UIStroke", textbox)
            stroke.Color = Color3.new(1,1,1)
            stroke.Thickness = 2
            textbox.FocusLost:Connect(function(enter)
                if enter then
                    local val = tonumber(textbox.Text)
                    if val then
                        local ls = LocalPlayer:FindFirstChild("leaderstats")
                        if ls then
                            local stat = ls:FindFirstChild(name)
                            if stat and stat:IsA("IntValue") then
                                stat.Value = math.floor(val)
                            end
                        end
                    end
                end
            end)
        end
    end
})

-- Auto Spin Wheel
local autoSpin = false
miscSection:Toggle({
    Title = "Auto Spin Wheel",
    Default = false,
    Callback = function(v)
        autoSpin = v
        task.spawn(function()
            while autoSpin do
                pcall(function()
                    ReplicatedStorage.rEvents.openFortuneWheelRemote:InvokeServer("openFortuneWheel", ReplicatedStorage.fortuneWheelChances["Fortune Wheel"])
                end)
                task.wait(5)
            end
        end)
    end
})

-- Auto Eat Inventory
local autoEatInventory = false
miscSection:Toggle({
    Title = "Auto Eat Inventory",
    Default = false,
    Callback = function(v)
        autoEatInventory = v
        task.spawn(function()
            while autoEatInventory do
                local items = {"Protein Shake", "Energy Bar", "Ultra Shake", "Protein Bar", "Energy Shake"}
                for _, item in pairs(items) do
                    local tool = LocalPlayer.Backpack:FindFirstChild(item)
                    if tool then
                        tool.Parent = LocalPlayer.Character
                        for i = 1, 5 do
                            VirtualInputManager:SendMouseButtonEvent(0,0,0,true,game,1)
                            task.wait()
                            VirtualInputManager:SendMouseButtonEvent(0,0,0,false,game,1)
                            task.wait(0.1)
                        end
                    end
                end
                task.wait(0.1)
            end
        end)
    end
})

-- Auto Claim Gifts
local autoClaimGifts = false
miscSection:Toggle({
    Title = "Auto Claim Gifts",
    Default = false,
    Callback = function(v)
        autoClaimGifts = v
        task.spawn(function()
            while autoClaimGifts do
                for i = 0, 10 do
                    pcall(function()
                        ReplicatedStorage.rEvents.freeGiftClaimRemote:InvokeServer("claimGift", i)
                    end)
                    task.wait(0.1)
                end
                task.wait(1)
            end
        end)
    end
})

-- Anti Knockback & Anti Fling
miscSection:Button({
    Title = "Anti Knockback & Anti Fling",
    Callback = function()
        local function fixParts()
            local char = LocalPlayer.Character
            if char then
                for _, part in pairs(char:GetDescendants()) do
                    if part:IsA("BasePart") then
                        part.CustomPhysicalProperties = PhysicalProperties.new(0,0,0)
                        part.Velocity = Vector3.zero
                        part.RotVelocity = Vector3.zero
                        part.AssemblyLinearVelocity = Vector3.zero
                        part.AssemblyAngularVelocity = Vector3.zero
                    end
                end
            end
        end
        LocalPlayer.CharacterAdded:Connect(function(char)
            char:WaitForChild("HumanoidRootPart")
            task.wait(1)
            fixParts()
        end)
        fixParts()
        RunService.Heartbeat:Connect(function()
            local char = LocalPlayer.Character
            if char then
                for _, part in pairs(char:GetDescendants()) do
                    if part:IsA("BasePart") then
                        part.Velocity = Vector3.zero
                        part.RotVelocity = Vector3.zero
                        part.AssemblyLinearVelocity = Vector3.zero
                        part.AssemblyAngularVelocity = Vector3.zero
                    end
                end
            end
        end)
    end
})

-- Full Walk On Water
local waterParts = {}
miscSection:Toggle({
    Title = "Full Walk On Water",
    Default = false,
    Callback = function(v)
        if v then
            local size = 2048
            local count = math.ceil(50000 / size)
            for x = 0, count-1 do
                for z = 0, count-1 do
                    for _, offset in pairs({{1,1}, {-1,1}, {-1,-1}, {1,-1}}) do
                        local part = Instance.new("Part")
                        part.Size = Vector3.new(size, 1, size)
                        part.Position = Vector3.new(-2, -9.5, -2) + Vector3.new(x * size * offset[1], 0, z * size * offset[2])
                        part.Anchored = true
                        part.Transparency = 1
                        part.CanCollide = true
                        part.Name = "WaterPart"
                        part.Parent = workspace
                        table.insert(waterParts, part)
                    end
                end
            end
        else
            for _, part in pairs(waterParts) do
                if part and part.Parent then
                    part.CanCollide = false
                end
            end
        end
    end
})

-- Optimizations
miscSection:Paragraph({ Title = "Optimizations" })
miscSection:Button({
    Title = "Remove Textures",
    Callback = function()
        for _, obj in pairs(game:GetDescendants()) do
            if obj:IsA("Decal") or obj:IsA("Texture") then
                obj.Transparency = 1
            end
        end
    end
})

miscSection:Button({
    Title = "Reduce Graphics",
    Callback = function()
        settings().Rendering.QualityLevel = Enum.QualityLevel.Level01
    end
})

miscSection:Button({
    Title = "Disable Shadows",
    Callback = function()
        Lighting.GlobalShadows = false
    end
})

miscSection:Button({
    Title = "Disable Effects",
    Callback = function()
        for _, obj in pairs(game:GetDescendants()) do
            if obj:IsA("ParticleEmitter") or obj:IsA("Smoke") or obj:IsA("Fire") or obj:IsA("Sparkles") then
                obj.Enabled = false
            end
        end
        for _, effect in pairs(Lighting:GetChildren()) do
            if effect:IsA("BlurEffect") or effect:IsA("SunRaysEffect") or effect:IsA("ColorCorrectionEffect") or effect:IsA("BloomEffect") or effect:IsA("DepthOfFieldEffect") then
                effect.Enabled = false
            end
        end
    end
})

miscSection:Button({
    Title = "Simplify Materials",
    Callback = function()
        for _, obj in pairs(game:GetDescendants()) do
            if obj:IsA("BasePart") and not obj:IsA("MeshPart") then
                obj.Material = Enum.Material.SmoothPlastic
                if not (obj.Parent and obj.Parent:FindFirstChild("Humanoid") or obj.Parent.Parent and obj.Parent.Parent:FindFirstChild("Humanoid")) then
                    obj.Reflectance = 0
                end
            end
        end
    end
})

miscSection:Button({
    Title = "Remove Fog",
    Callback = function()
        Lighting.FogEnd = 1e10
    end
})

miscSection:Button({
    Title = "Ultra FPS Booster",
    Callback = function()
        settings().Rendering.QualityLevel = Enum.QualityLevel.Level01
        settings().Rendering.MeshPartDetailLevel = Enum.MeshPartDetailLevel.Level01
        settings().Rendering.EagerBulkExecution = true
        Lighting.GlobalShadows = false
        Lighting.FogEnd = 1e10
        Lighting.Brightness = 0
        for _, obj in pairs(game:GetDescendants()) do
            if obj:IsA("ParticleEmitter") or obj:IsA("Trail") or obj:IsA("Smoke") or obj:IsA("Fire") or obj:IsA("Sparkles") then
                obj:Destroy()
            end
            if obj:IsA("PointLight") or obj:IsA("SpotLight") or obj:IsA("SurfaceLight") then
                obj.Enabled = false
            end
            if obj:IsA("Sound") then
                obj:Stop()
                obj.Volume = 0
            end
            if obj:IsA("Decal") or obj:IsA("Texture") then
                obj:Destroy()
            end
        end
        local terrain = workspace:FindFirstChildOfClass("Terrain")
        if terrain then
            terrain.WaterWaveSize = 0
            terrain.WaterWaveSpeed = 0
            terrain.WaterReflectance = 0
            terrain.WaterTransparency = 1
            terrain.Decorations = false
        end
    end
})

-- Notificacao inicial
WindUI:Notify({
    Title = "Saturn Hub",
    Content = "by satn",
    Duration = 5
})
