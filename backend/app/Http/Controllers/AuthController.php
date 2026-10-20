<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\ValidationException;

class AuthController extends Controller
{
    /** Public, tiny: lets the login page hide the sign-up form on private instances. */
    public function options(): JsonResponse
    {
        return response()->json(['registration' => (bool) config('app.registration_enabled')]);
    }

    public function register(Request $request): JsonResponse
    {
        if (! config('app.registration_enabled')) {
            return response()->json(['message' => 'Pendaftaran akun dinonaktifkan di instalasi ini.'], 403);
        }

        $data = $request->validate([
            'name' => 'required|string|max:100',
            'email' => 'required|email|max:190|unique:users,email',
            'password' => 'required|string|min:8|max:200',
        ]);

        $user = User::create($data);

        return response()->json([
            'user' => $user->only('id', 'name', 'email'),
            'token' => $user->createToken('web')->plainTextToken,
        ], 201);
    }

    public function login(Request $request): JsonResponse
    {
        $data = $request->validate([
            'email' => 'required|email',
            'password' => 'required|string',
        ]);

        if (! Auth::validate($data)) {
            throw ValidationException::withMessages(['email' => 'Email atau password salah.']);
        }

        $user = User::where('email', $data['email'])->firstOrFail();

        return response()->json([
            'user' => $user->only('id', 'name', 'email'),
            'token' => $user->createToken('web')->plainTextToken,
        ]);
    }

    public function me(Request $request): JsonResponse
    {
        return response()->json(['user' => $request->user()->only('id', 'name', 'email')]);
    }

    public function logout(Request $request): JsonResponse
    {
        $request->user()->currentAccessToken()->delete();

        return response()->json(['ok' => true]);
    }
}
